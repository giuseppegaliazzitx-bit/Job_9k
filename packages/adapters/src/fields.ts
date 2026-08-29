import type { Locator, Page } from "playwright";
import { fuzzyScore, lookupValue, mergeChoices, pickClosestChoice, type AnswerBank, type Profile } from "@job9k/core";
import type { AdapterContext, FieldOutcome } from "./types.js";

const OPTION_SELECTORS = [
  ".select__option",
  '[role="option"]',
  ".select2-results__option",
  '[class*="menu"] [class*="option"]',
  '[class*="listbox"] [class*="option"]',
  "li[class*='option']",
  ".dropdown-item",
  "div[data-value]",
  '[class*="MenuItem"]',
].join(", ");

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function waitIfPaused(ctx: AdapterContext): Promise<void> {
  while (ctx.shouldPause()) await sleep(200);
}

export async function typeFill(locator: Locator, value: string, delay: number): Promise<void> {
  await locator.click({ timeout: 4000 });
  await locator.fill("");
  if (delay > 0) await locator.pressSequentially(value, { delay });
  else await locator.fill(value);
}

export async function fieldDescriptor(page: Page, loc: Locator): Promise<string> {
  const id = await loc.getAttribute("id");
  const aria = ((await loc.getAttribute("aria-label")) ?? "").trim();
  const labelledBy = await loc.getAttribute("aria-labelledby");
  let labelledByText = "";
  if (labelledBy) {
    const firstId = labelledBy.trim().split(/\s+/)[0];
    labelledByText = ((await page.locator(`[id="${firstId}"]`).first().textContent().catch(() => "")) ?? "").trim();
  }
  let forLabel = "";
  if (id) {
    forLabel = ((await page.locator(`label[for="${id}"]`).first().textContent().catch(() => "")) ?? "").trim();
  }
  const nearby = await loc
    .evaluate((el) => {
      const lab = el.closest("label") || el.parentElement?.querySelector("label");
      return lab?.textContent?.trim() ?? "";
    })
    .catch(() => "");
  const placeholder = ((await loc.getAttribute("placeholder")) ?? "").trim();
  const name = ((await loc.getAttribute("name")) ?? "").trim();
  const human = forLabel || labelledByText || aria || nearby || placeholder || name || id || "";
  return human.replace(/\s+/g, " ").trim();
}

function uniqueChoices(raw: string[]): string[] {
  return mergeChoices([], raw);
}

export async function readNativeSelectChoices(loc: Locator): Promise<string[]> {
  const raw = await loc
    .evaluate((el) => {
      if (!(el instanceof HTMLSelectElement)) return [];
      return [...el.options].map((o) => (o.textContent || o.label || o.value || "").trim());
    })
    .catch(() => [] as string[]);
  return uniqueChoices(raw);
}

async function readGroupedInputChoices(page: Page, loc: Locator): Promise<string[]> {
  const name = await loc.getAttribute("name");
  const type = ((await loc.getAttribute("type")) ?? "radio").toLowerCase();
  if (!name) return [];
  const inputs = page.locator(`input[type="${type}"][name="${name.replace(/"/g, '\\"')}"]`);
  const n = Math.min(await inputs.count().catch(() => 0), 80);
  const raw: string[] = [];
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const value = (await el.getAttribute("value").catch(() => "")) ?? "";
    const id = await el.getAttribute("id");
    let label = "";
    if (id) {
      label = ((await page.locator(`label[for="${id}"]`).first().textContent().catch(() => "")) ?? "").trim();
    }
    if (!label) {
      label = await el
        .evaluate((node) => {
          const lab = node.closest("label") || node.parentElement;
          return lab?.textContent?.trim() ?? "";
        })
        .catch(() => "");
    }
    raw.push(label || value);
  }
  return uniqueChoices(raw);
}

export async function readOpenListChoices(page: Page, loc: Locator): Promise<string[]> {
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  await loc.click({ timeout: 2500 }).catch(() => undefined);
  await sleep(280);
  const listId = await loc.getAttribute("aria-controls");
  const safeId = listId ? listId.replace(/([^\w-])/g, "\\$1") : "";
  const scoped = safeId
    ? page.locator(`#${safeId} [role="option"], #${safeId} li`)
    : page.locator(OPTION_SELECTORS);
  const count = Math.min(await scoped.count().catch(() => 0), 250);
  const raw: string[] = [];
  for (let i = 0; i < count; i++) {
    const opt = scoped.nth(i);
    if (!(await opt.isVisible().catch(() => false))) continue;
    raw.push(((await opt.textContent()) ?? "").trim());
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  return uniqueChoices(raw);
}

export async function readFieldChoices(page: Page, loc: Locator): Promise<string[]> {
  const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
  const type = ((await loc.getAttribute("type")) ?? "").toLowerCase();
  const role = ((await loc.getAttribute("role")) ?? "").toLowerCase();
  const aria = await loc.getAttribute("aria-haspopup");
  const expanded = await loc.getAttribute("aria-expanded");

  if (tag === "select") return readNativeSelectChoices(loc);
  if (type === "radio" || type === "checkbox") return readGroupedInputChoices(page, loc);
  if (role === "combobox" || aria === "listbox" || aria === "true" || expanded !== null) {
    return readOpenListChoices(page, loc);
  }

  const nested = loc.locator("select").first();
  if ((await nested.count().catch(() => 0)) > 0) return readNativeSelectChoices(nested);

  const nearby = loc.locator("xpath=ancestor::*[self::div or self::fieldset or self::label][1]//select").first();
  if ((await nearby.count().catch(() => 0)) > 0) return readNativeSelectChoices(nearby);

  return [];
}

export async function blockedOutcome(
  page: Page,
  loc: Locator,
  label: string,
  required: boolean,
  extraChoices: string[] = [],
): Promise<FieldOutcome> {
  const scraped = await readFieldChoices(page, loc).catch(() => [] as string[]);
  return {
    label,
    value: "",
    confidence: "blocked",
    required,
    choices: mergeChoices(extraChoices, scraped),
  };
}

export async function handleNativeSelect(loc: Locator, value: string): Promise<boolean> {
  const choices = await readNativeSelectChoices(loc);
  const snapped = pickClosestChoice(value, choices);
  try {
    await loc.selectOption({ label: snapped }, { timeout: 2000 });
    return true;
  } catch {
    try {
      await loc.selectOption({ value: snapped }, { timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  }
}

export async function verifyDropdownFilled(loc: Locator): Promise<boolean> {
  try {
    const val = (await loc.inputValue()).trim();
    if (val && !/^(select\.?\.?\.?)$/i.test(val)) return true;
  } catch {
    /* not an input */
  }
  return loc
    .evaluate((el) => {
      const root = el.closest(".select, [class*='select__'], .iti") || el.parentElement;
      if (!root) return false;
      const sv = root.querySelector(":scope > .select__single-value, :scope .select__single-value, [class*='singleValue']");
      const text = sv?.textContent?.trim() ?? "";
      if (text && !/^select/i.test(text)) return true;
      const multi = root.querySelectorAll(".select__multi-value, [class*='multiValue']");
      if (multi.length > 0) return true;
      if (el instanceof HTMLSelectElement) {
        const opt = el.selectedOptions[0];
        return Boolean(opt && opt.value && opt.text && !/^select/i.test(opt.text.trim()));
      }
      return false;
    })
    .catch(() => false);
}

async function bestVisibleOption(
  page: Page,
  value: string,
): Promise<{ index: number; score: number } | null> {
  const options = page.locator(OPTION_SELECTORS);
  const count = Math.min(await options.count().catch(() => 0), 250);
  let bestIdx = -1;
  let best = 0;
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    if (!(await opt.isVisible().catch(() => false))) continue;
    const text = ((await opt.textContent()) ?? "").trim();
    if (!text || text === "No options" || text.length > 120) continue;
    const score = fuzzyScore(value, text);
    if (score > best) {
      best = score;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 && best >= 0.3 ? { index: bestIdx, score: best } : null;
}

export async function handleDropdown(page: Page, loc: Locator, value: string): Promise<boolean> {
  const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") return handleNativeSelect(loc, value);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await loc.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
      await sleep(200);
      await loc.click({ timeout: 4000 });
      await sleep(250);
      try {
        await loc.fill("");
        await loc.pressSequentially(value.slice(0, 18), { delay: 50 });
      } catch {
        /* not a text input */
      }
      await sleep(400 * attempt);
      const match = await bestVisibleOption(page, value);
      if (match) {
        await page.locator(OPTION_SELECTORS).nth(match.index).click();
        await sleep(400);
        if (await verifyDropdownFilled(loc)) return true;
      }
    } catch {
      /* retry */
    }
  }

  try {
    await page.keyboard.press("Escape").catch(() => undefined);
    await sleep(200);
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    await loc.click({ timeout: 3000 });
    await sleep(700);
    const match = await bestVisibleOption(page, value);
    if (match) {
      await page.locator(OPTION_SELECTORS).nth(match.index).click();
      await sleep(400);
      if (await verifyDropdownFilled(loc)) return true;
    }
  } catch {
    /* click-scan failed */
  }

  try {
    await page.keyboard.press("Escape").catch(() => undefined);
    await sleep(150);
    await loc.click({ timeout: 2500 });
    await sleep(250);
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("ArrowDown");
      await sleep(70);
      const active = page.locator('.select__option--is-focused, [role="option"][aria-selected="true"]').first();
      if ((await active.count()) === 0) continue;
      const text = ((await active.textContent()) ?? "").trim();
      if (fuzzyScore(value, text) >= 0.5) {
        await page.keyboard.press("Enter");
        await sleep(350);
        if (await verifyDropdownFilled(loc)) return true;
        break;
      }
    }
  } catch {
    /* keyboard nav failed */
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return false;
}

export async function fillSelectOrDropdown(page: Page, loc: Locator, value: string): Promise<boolean> {
  const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
  const role = ((await loc.getAttribute("role")) ?? "").toLowerCase();
  const aria = await loc.getAttribute("aria-haspopup");
  if (tag === "select") return handleNativeSelect(loc, value);
  if (role === "combobox" || aria === "listbox" || aria === "true") return handleDropdown(page, loc, value);
  try {
    return handleDropdown(page, loc, value);
  } catch {
    return false;
  }
}

export async function uploadFirstMatching(
  page: Page,
  selectors: string[],
  filePath: string,
): Promise<boolean> {
  if (!filePath) return false;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.setInputFiles(filePath, { timeout: 5000 });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

export async function fillByLookup(
  ctx: AdapterContext,
  loc: Locator,
  kind: "text" | "select" | "dropdown" | "yesno",
): Promise<FieldOutcome | null> {
  await waitIfPaused(ctx);
  const label = (await fieldDescriptor(ctx.page, loc)) || (await loc.getAttribute("name")) || "field";
  const mapped = lookupValue(label, ctx.profile, ctx.answers);

  if (!mapped.value) {
    if (mapped.knockout) {
      const decision = await ctx.onUnknownQuestion(label, "");
      if (decision === "skip-job") throw new SkipJobError(label);
      if (decision === "leave") {
        const outcome = await blockedOutcome(ctx.page, loc, label, true, kind === "yesno" ? ["Yes", "No"] : []);
        ctx.onField(outcome);
        return outcome;
      }
      mapped.value = decision.value;
      mapped.confidence = "filled";
    } else {
      const outcome = await blockedOutcome(ctx.page, loc, label, false, kind === "yesno" ? ["Yes", "No"] : []);
      ctx.onField(outcome);
      return outcome;
    }
  }

  let ok = false;
  if (kind === "text") {
    try {
      await typeFill(loc, mapped.value, ctx.typingDelayMs);
      ok = true;
    } catch {
      ok = false;
    }
  } else if (kind === "select" || kind === "dropdown") {
    ok = await fillSelectOrDropdown(ctx.page, loc, mapped.value);
  } else if (kind === "yesno") {
    ok = await clickYesNo(ctx.page, loc, mapped.value);
  }

  const outcome: FieldOutcome = {
    label,
    value: mapped.value,
    confidence: ok ? mapped.confidence : "blocked",
    required: mapped.knockout,
    choices: ok ? [] : await readFieldChoices(ctx.page, loc).catch(() => [] as string[]),
  };
  if (kind === "yesno" && !ok) outcome.choices = mergeChoices(["Yes", "No"], outcome.choices);
  ctx.onField(outcome);
  return outcome;
}

export async function handleTypeahead(page: Page, loc: Locator, value: string): Promise<boolean> {
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await loc.click({ timeout: 3000 }).catch(() => undefined);
  await sleep(150);
  try {
    await loc.fill("");
    await loc.pressSequentially(value, { delay: 40 });
  } catch {
    await loc.fill(value).catch(() => undefined);
  }
  await sleep(900);
  const match = await bestVisibleOption(page, value);
  if (match) {
    await page.locator(OPTION_SELECTORS).nth(match.index).click();
    await sleep(300);
    return true;
  }
  const first = page.locator('[role="option"], [class*="suggestion"], [class*="autocomplete"] li').first();
  if (await first.isVisible().catch(() => false)) {
    await first.click().catch(() => undefined);
    await sleep(250);
    return true;
  }
  return Boolean((await loc.inputValue().catch(() => "")).trim());
}

export async function handlePhoneCountry(page: Page, loc: Locator, value: string): Promise<boolean> {
  const flag = loc
    .locator('xpath=ancestor::*[contains(@class,"iti")][1]//div[contains(@class,"iti__flag-container") or contains(@class,"iti__selected-flag")]')
    .first();
  const clickTarget = (await flag.count()) > 0 ? flag : loc;
  await clickTarget.click({ timeout: 3000 }).catch(() => undefined);
  await sleep(300);
  const search = page.locator(".iti__search-input, input[aria-label='Search']").first();
  if ((await search.count()) > 0 && (await search.isVisible().catch(() => false))) {
    await search.fill(value).catch(() => undefined);
    await sleep(400);
  }
  const opt = page.locator(`li[role="option"]:has-text("${value}"), .iti__country:has-text("${value}")`).first();
  if ((await opt.count()) > 0 && (await opt.isVisible().catch(() => false))) {
    await opt.click();
    await sleep(250);
    return true;
  }
  return handleDropdown(page, loc, value);
}

export async function handleYesNoButton(page: Page, label: string, value: string): Promise<boolean> {
  const want = /^(yes|true|y)$/i.test(value.trim()) ? "Yes" : /^(no|false|n)$/i.test(value.trim()) ? "No" : value;
  const payload = JSON.stringify({ labelText: label, targetValue: want });
  const clicked = await page.evaluate(`((arg) => {
    const labelText = arg.labelText;
    const targetValue = arg.targetValue;
    const labels = Array.from(document.querySelectorAll("label, p, h3, h4, span, legend"));
    const target = labels.find((l) => {
      const t = (l.textContent || "").trim();
      return t.startsWith(labelText.slice(0, 40)) || (t.length < labelText.length + 40 && t.includes(labelText.slice(0, 30)));
    });
    if (!target) return false;
    const container = target.closest('[class*="field"], [class*="question"], [class*="Field"], [class*="Question"]') || target.parentElement;
    if (!container) return false;
    const buttons = container.querySelectorAll("button");
    for (const btn of buttons) {
      if ((btn.textContent || "").trim() === targetValue) { btn.click(); return true; }
    }
    return false;
  })(${payload})`);
  if (clicked) return true;
  return clickYesNo(page, page.locator(`text=${label.slice(0, 40)}`).first(), want);
}

export async function clickYesNo(page: Page, around: Locator, value: string): Promise<boolean> {
  const wantYes = /^(yes|true|y)$/i.test(value.trim());
  const root = around.locator("xpath=ancestor::*[self::div or self::fieldset or self::form][1]");
  const target = wantYes ? /^(yes)$/i : /^(no)$/i;
  const buttons = root.getByRole("button");
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const t = ((await buttons.nth(i).textContent()) ?? "").trim();
    if (target.test(t)) {
      await buttons.nth(i).click();
      return true;
    }
  }
  const radios = page.getByRole("radio");
  const rcount = await radios.count().catch(() => 0);
  for (let i = 0; i < rcount; i++) {
    const t = ((await radios.nth(i).getAttribute("value")) ?? (await radios.nth(i).textContent()) ?? "").trim();
    if (target.test(t) || (wantYes && /yes/i.test(t)) || (!wantYes && /no/i.test(t))) {
      await radios.nth(i).click();
      return true;
    }
  }
  return false;
}

export class SkipJobError extends Error {
  constructor(public question: string) {
    super(`Skipped on question: ${question}`);
    this.name = "SkipJobError";
  }
}

export async function extractPageMeta(page: Page): Promise<{ title: string; company: string; jd: string }> {
  return page.evaluate(() => {
    const h1 = document.querySelector("h1, [data-automation-id='jobPostingHeader'], .app-title, .posting-headline h2");
    const title = h1?.textContent?.trim() || document.title.split(/[-|@]/)[0]?.trim() || "";
    const jdSelectors = [
      ".job-post-content",
      ".job-description",
      ".posting-description",
      "#job-description",
      "[data-automation-id='jobPostingDescription']",
      "[class*='jobDescription']",
      "article",
    ];
    let jd = "";
    for (const sel of jdSelectors) {
      const el = document.querySelector(sel);
      if (el && (el.textContent?.trim().length ?? 0) > 80) {
        jd = el.textContent!.trim();
        break;
      }
    }
    if (!jd) jd = document.body?.innerText?.slice(0, 4000) ?? "";
    return { title, company: "", jd: jd.slice(0, 4000) };
  });
}

export async function clickApplyIfPresent(page: Page, extra: string[] = []): Promise<void> {
  const selectors = [
    ...extra,
    'a:has-text("Apply for this job")',
    'button:has-text("Apply for this job")',
    'a:has-text("Apply Now")',
    'button:has-text("Apply Now")',
    'a:has-text("Apply")',
    'button:has-text("Apply")',
    "#apply_button",
    ".apply-button",
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    return;
  }
}

export function mapFromProfile(label: string, profile: Profile, answers: AnswerBank) {
  return lookupValue(label, profile, answers);
}

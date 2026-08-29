import type { Locator, Page } from "playwright";
import { fuzzyScore, lookupValue, mergeChoices, type AnswerBank, type Profile } from "@job9k/core";
import type { AdapterContext, FieldOutcome } from "./types.js";

const OPTION_SELECTORS = [
  ".select__option",
  '[role="option"]',
  ".select2-results__option",
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
  const parts: string[] = [];
  const placeholder = await loc.getAttribute("placeholder");
  const name = await loc.getAttribute("name");
  const id = await loc.getAttribute("id");
  const aria = await loc.getAttribute("aria-label");
  if (placeholder) parts.push(placeholder);
  if (name) parts.push(name);
  if (id) parts.push(id);
  if (aria) parts.push(aria);
  if (id) {
    const label = await page.locator(`label[for="${id}"]`).first().textContent().catch(() => null);
    if (label) parts.push(label);
  }
  const nearby = await loc.evaluate((el) => {
    const lab = el.closest("label") || el.parentElement?.querySelector("label");
    return lab?.textContent?.trim() ?? "";
  }).catch(() => "");
  if (nearby) parts.push(nearby);
  return parts.join(" ").replace(/\s+/g, " ").trim();
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
  try {
    await loc.selectOption({ label: value }, { timeout: 2000 });
    return true;
  } catch {
    try {
      await loc.selectOption({ value }, { timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  }
}

export async function handleDropdown(page: Page, loc: Locator, value: string): Promise<boolean> {
  const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") return handleNativeSelect(loc, value);

  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  await loc.click({ timeout: 4000 }).catch(() => undefined);
  await sleep(250);
  try {
    await loc.fill("");
    await loc.pressSequentially(value.slice(0, 20), { delay: 40 });
  } catch {
    // not a text input
  }
  await sleep(500);

  const options = page.locator(OPTION_SELECTORS);
  const count = await options.count();
  let bestIdx = -1;
  let best = 0;
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    if (!(await opt.isVisible().catch(() => false))) continue;
    const text = ((await opt.textContent()) ?? "").trim();
    if (!text || text === "No options") continue;
    const score = fuzzyScore(value, text);
    if (score > best) {
      best = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && best >= 0.3) {
    await options.nth(bestIdx).click();
    await sleep(300);
    return true;
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  return false;
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
  } else if (kind === "select") {
    ok = await handleNativeSelect(loc, mapped.value);
  } else if (kind === "dropdown") {
    ok = await handleDropdown(ctx.page, loc, mapped.value);
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

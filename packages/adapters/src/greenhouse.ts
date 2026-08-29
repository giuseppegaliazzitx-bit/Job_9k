import type { Page } from "playwright";
import { lookupValue } from "@job9k/core";
import type { AdapterContext, AdapterResult, AtsAdapter, FieldOutcome } from "./types.js";
import {
  blockedOutcome,
  clickApplyIfPresent,
  fieldDescriptor,
  handleDropdown,
  handleNativeSelect,
  readFieldChoices,
  SkipJobError,
  typeFill,
  uploadFirstMatching,
  waitIfPaused,
} from "./fields.js";

async function fillGreenhouseField(ctx: AdapterContext, loc: import("playwright").Locator): Promise<FieldOutcome | null> {
  if (!(await loc.isVisible().catch(() => false))) return null;
  const type = ((await loc.getAttribute("type")) ?? "").toLowerCase();
  if (type === "hidden" || type === "submit" || type === "button") return null;
  const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
  const label = (await fieldDescriptor(ctx.page, loc)) || "field";
  if (/recaptcha|honeypot|search/i.test(label)) return null;

  const mapped = lookupValue(label, ctx.profile, ctx.answers);
  const required = mapped.knockout || (await loc.getAttribute("required")) !== null || /\*/.test(label);
  if (!mapped.value) {
    if (mapped.knockout) {
      const decision = await ctx.onUnknownQuestion(label, "");
      if (decision === "skip-job") throw new SkipJobError(label);
      if (decision === "leave") {
        const o = await blockedOutcome(ctx.page, loc, label, true);
        ctx.onField(o);
        return o;
      }
      mapped.value = decision.value;
      mapped.confidence = "filled";
    } else {
      const o = await blockedOutcome(ctx.page, loc, label, required);
      ctx.onField(o);
      return o;
    }
  }

  await waitIfPaused(ctx);
  let ok = false;
  if (type === "checkbox" || type === "radio") {
    const o: FieldOutcome = {
      label,
      value: mapped.value,
      confidence: "guessed",
      required: mapped.knockout,
      choices: await readFieldChoices(ctx.page, loc).catch(() => [] as string[]),
    };
    ctx.onField(o);
    return o;
  }
  if (tag === "select") ok = await handleNativeSelect(loc, mapped.value);
  else {
    const role = await loc.getAttribute("role");
    const aria = await loc.getAttribute("aria-haspopup");
    if (role === "combobox" || aria === "listbox" || aria === "true") {
      ok = await handleDropdown(ctx.page, loc, mapped.value);
    } else {
      try {
        await typeFill(loc, mapped.value, ctx.typingDelayMs);
        ok = true;
      } catch {
        ok = await handleDropdown(ctx.page, loc, mapped.value);
      }
    }
  }
  const outcome: FieldOutcome = {
    label,
    value: mapped.value,
    confidence: ok ? mapped.confidence : "blocked",
    required,
    choices: ok ? [] : await readFieldChoices(ctx.page, loc).catch(() => [] as string[]),
  };
  ctx.onField(outcome);
  return outcome;
}

export const greenhouseAdapter: AtsAdapter = {
  ats: "greenhouse",
  allowsAutoSubmit: true,

  async detect(url: string, page: Page) {
    if (/greenhouse\.io/i.test(url)) return true;
    return (await page.locator("#application_form, #app_body").count()) > 0;
  },

  async navigateToForm(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    if (!page.url().includes("#app")) {
      await clickApplyIfPresent(page, ['a[href*="#app"]', "a.postings-btn"]);
    }
    await page.evaluate(() => {
      const app = document.getElementById("application") || document.getElementById("app_body") || document.getElementById("app");
      app?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    });
    await page.waitForSelector("input[type='text'], input[type='email'], #first_name", { timeout: 8000 }).catch(() => undefined);
    return page.url();
  },

  async fill(ctx: AdapterContext): Promise<AdapterResult> {
    const { page, profile } = ctx;
    const outcomes: FieldOutcome[] = [];

    const named: Array<[string, string]> = [
      ["#first_name, input[name='first_name']", profile.identity.first_name],
      ["#last_name, input[name='last_name']", profile.identity.last_name],
      ["#email, input[name='email']", profile.identity.email],
      ["#phone, input[name='phone']", profile.identity.phone],
      ["input[name*='linkedin' i], #linkedin", profile.identity.linkedin],
      ["input[name*='github' i]", profile.identity.github],
      ["input[name*='website' i], input[name*='portfolio' i]", profile.identity.portfolio],
    ];
    for (const [sel, value] of named) {
      if (!value) continue;
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      await waitIfPaused(ctx);
      try {
        await typeFill(loc, value, ctx.typingDelayMs);
        const label = (await fieldDescriptor(page, loc)) || sel;
        const o: FieldOutcome = { label, value, confidence: "filled", required: true };
        outcomes.push(o);
        ctx.onField(o);
      } catch {
        /* continue */
      }
    }

    if (profile.identity.location) {
      const locField = page.locator("input[name*='location' i], #job_application_location, input[placeholder*='Location' i]").first();
      if ((await locField.count()) > 0) {
        await typeFill(locField, profile.identity.location, ctx.typingDelayMs).catch(() => undefined);
        await page.waitForTimeout(600);
        const opt = page.locator('[role="option"], .select__option').first();
        if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => undefined);
        const o: FieldOutcome = { label: "Location", value: profile.identity.location, confidence: "filled", required: false };
        outcomes.push(o);
        ctx.onField(o);
      }
    }

    if (ctx.resumePath) {
      const uploaded = await uploadFirstMatching(page, ["#resume", "input[type='file'][name*='resume' i]", "input[type='file']"], ctx.resumePath);
      const o: FieldOutcome = {
        label: "Resume",
        value: ctx.resumePath,
        confidence: uploaded ? "filled" : "blocked",
        required: true,
      };
      outcomes.push(o);
      ctx.onField(o);
    }
    if (ctx.coverLetterPath) {
      const uploaded = await uploadFirstMatching(page, ["#cover_letter", "input[type='file'][name*='cover' i]"], ctx.coverLetterPath);
      const o: FieldOutcome = {
        label: "Cover letter",
        value: ctx.coverLetterPath,
        confidence: uploaded ? "filled" : "blocked",
        required: false,
      };
      outcomes.push(o);
      ctx.onField(o);
    }

    const rest = page.locator(
      "#application_form input:not([type='file']):not([type='hidden']):not([type='submit']), #application_form select, #application_form textarea, form input:not([type='file']):not([type='hidden']), form select, form textarea, [role='combobox']",
    );
    const n = await rest.count();
    const seen = new Set(outcomes.map((o) => o.label.toLowerCase()));
    for (let i = 0; i < n; i++) {
      const loc = rest.nth(i);
      const current = await loc.inputValue().catch(() => "");
      if (current.trim()) continue;
      const result = await fillGreenhouseField(ctx, loc);
      if (result && !seen.has(result.label.toLowerCase())) {
        seen.add(result.label.toLowerCase());
        outcomes.push(result);
      }
    }

    return { outcomes };
  },

  async submit(page: Page) {
    const btn = page.locator("#submit_app, button:has-text('Submit application'), input[type='submit']").first();
    if ((await btn.count()) === 0) return false;
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    return true;
  },
};

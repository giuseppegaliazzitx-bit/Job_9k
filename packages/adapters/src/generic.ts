import type { Page } from "playwright";
import { lookupValue } from "@job9k/core";
import type { AdapterContext, AdapterResult, AtsAdapter, FieldOutcome } from "./types.js";
import {
  blockedOutcome,
  clickApplyIfPresent,
  fieldDescriptor,
  fillSelectOrDropdown,
  typeFill,
  uploadFirstMatching,
  waitIfPaused,
} from "./fields.js";

async function fillObvious(ctx: AdapterContext): Promise<FieldOutcome[]> {
  const { page } = ctx;
  const outcomes: FieldOutcome[] = [];
  const locators = page.locator(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea, select, [role="combobox"]',
  );
  const n = await locators.count();
  for (let i = 0; i < n; i++) {
    const loc = locators.nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    const current = await loc.inputValue().catch(() => "");
    if (current.trim()) continue;
    const label = await fieldDescriptor(page, loc);
    const mapped = lookupValue(label, ctx.profile, ctx.answers);
    if (!mapped.value) {
      const o = await blockedOutcome(page, loc, label, mapped.knockout);
      outcomes.push(o);
      ctx.onField(o);
      continue;
    }
    await waitIfPaused(ctx);
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
    let ok = false;
    if (tag === "select" || (await loc.getAttribute("role")) === "combobox") {
      ok = await fillSelectOrDropdown(page, loc, mapped.value);
    } else {
      try {
        await typeFill(loc, mapped.value, ctx.typingDelayMs);
        ok = true;
      } catch {
        ok = await fillSelectOrDropdown(page, loc, mapped.value);
      }
    }
    const o: FieldOutcome = {
      label,
      value: mapped.value,
      confidence: ok ? mapped.confidence : "blocked",
      required: mapped.knockout,
    };
    outcomes.push(o);
    ctx.onField(o);
  }
  return outcomes;
}

export const genericAdapter: AtsAdapter = {
  ats: "custom",
  allowsAutoSubmit: false,

  async detect() {
    return true;
  },

  async navigateToForm(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await clickApplyIfPresent(page);
    await page.waitForTimeout(800);
    return page.url();
  },

  async fill(ctx: AdapterContext): Promise<AdapterResult> {
    const outcomes = await fillObvious(ctx);
    if (ctx.resumePath) {
      const uploaded = await uploadFirstMatching(
        ctx.page,
        ["input[type='file'][name*='resume' i]", "input[type='file'][accept*='pdf']", "input[type='file']"],
        ctx.resumePath,
      );
      const o: FieldOutcome = { label: "Resume", value: ctx.resumePath, confidence: uploaded ? "filled" : "blocked", required: true };
      outcomes.push(o);
      ctx.onField(o);
    }
    if (ctx.coverLetterPath) {
      await uploadFirstMatching(ctx.page, ["input[type='file'][name*='cover' i]"], ctx.coverLetterPath);
    }
    return { outcomes, pauseReason: "Custom page — filled obvious identity fields and paused." };
  },
};

export { fillObvious };

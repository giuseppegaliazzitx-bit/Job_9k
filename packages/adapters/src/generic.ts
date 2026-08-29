import type { Page } from "playwright";
import type { AdapterContext, AdapterResult, AtsAdapter, FieldOutcome } from "./types.js";
import { clickApplyIfPresent, uploadFirstMatching } from "./fields.js";
import { scanPlanFill } from "./engine.js";

async function fillObvious(ctx: AdapterContext): Promise<FieldOutcome[]> {
  return scanPlanFill(ctx, { skipCheckbox: true, ats: "custom" });
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

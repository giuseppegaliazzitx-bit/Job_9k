import type { Page } from "playwright";
import type { AdapterContext, AdapterResult, AtsAdapter, FieldOutcome } from "./types.js";
import { clickApplyIfPresent, typeFill, uploadFirstMatching, waitIfPaused } from "./fields.js";
import { scanPlanFill } from "./engine.js";

export const ashbyAdapter: AtsAdapter = {
  ats: "ashby",
  allowsAutoSubmit: false,

  async detect(url, page) {
    if (/ashbyhq\.com/i.test(url)) return true;
    return (await page.locator('[data-testid="ashby-job-posting"]').count()) > 0;
  },

  async navigateToForm(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await clickApplyIfPresent(page);
    await page.waitForSelector("input[type='text'], input[type='email']", { timeout: 8000 }).catch(() => undefined);
    return page.url();
  },

  async fill(ctx: AdapterContext): Promise<AdapterResult> {
    const { page, profile } = ctx;
    const outcomes: FieldOutcome[] = [];

    const body = (await page.locator("body").innerText().catch(() => "")) ?? "";
    const already = /already (applied|submitted)|email.{0,40}already/i.test(body);
    if (already) {
      ctx.log("Ashby: this email may already have been used at this company.", "warn");
    }

    const named: Array<[string, string, string]> = [
      ["input[name*='name' i], input[placeholder*='Name' i]", `${profile.identity.first_name} ${profile.identity.last_name}`.trim(), "Name"],
      ["input[type='email'], input[name*='email' i]", profile.identity.email, "Email"],
      ["input[type='tel'], input[name*='phone' i]", profile.identity.phone, "Phone"],
      ["input[name*='linkedin' i]", profile.identity.linkedin, "LinkedIn"],
      ["input[name*='location' i], input[placeholder*='Location' i]", profile.identity.location, "Location"],
    ];
    for (const [sel, value, label] of named) {
      if (!value) continue;
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      await waitIfPaused(ctx);
      await typeFill(loc, value, ctx.typingDelayMs).catch(() => undefined);
      // typeahead pick
      const opt = page.locator('[role="option"]').first();
      if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => undefined);
      const o: FieldOutcome = { label, value, confidence: "filled", required: true };
      outcomes.push(o);
      ctx.onField(o);
    }

    if (ctx.resumePath) {
      const uploaded = await uploadFirstMatching(page, ["input[type='file']"], ctx.resumePath);
      const o: FieldOutcome = { label: "Resume", value: ctx.resumePath, confidence: uploaded ? "filled" : "blocked", required: true };
      outcomes.push(o);
      ctx.onField(o);
    }

    outcomes.push(...(await scanPlanFill(ctx, { ats: "ashby" })));
    return { outcomes, alreadyApplied: already };
  },
};

import type { Page } from "playwright";
import { lookupValue } from "@job9k/core";
import type { AdapterContext, AdapterResult, AtsAdapter, FieldOutcome } from "./types.js";
import { fieldDescriptor, typeFill, uploadFirstMatching, waitIfPaused } from "./fields.js";

export const leverAdapter: AtsAdapter = {
  ats: "lever",
  allowsAutoSubmit: true,

  async detect(url, page) {
    if (/lever\.co/i.test(url)) return true;
    return (await page.locator(".lever-application-form, .application-form").count()) > 0;
  },

  async navigateToForm(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!/\/apply/i.test(page.url())) {
      const apply = page.locator('a[href*="/apply"], a.postings-btn:has-text("Apply")').first();
      if ((await apply.count()) > 0) {
        const href = await apply.getAttribute("href");
        if (href) await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded" });
        else await apply.click();
        await page.waitForTimeout(1000);
      }
    }
    await page.waitForSelector("input[type='text'], input[type='email'], input[name='name']", { timeout: 8000 }).catch(() => undefined);
    return page.url();
  },

  async fill(ctx: AdapterContext): Promise<AdapterResult> {
    const { page, profile } = ctx;
    const outcomes: FieldOutcome[] = [];
    const full = `${profile.identity.first_name} ${profile.identity.last_name}`.trim();

    const named: Array<[string, string, string]> = [
      ["input[name='name'], #name", full, "Full name"],
      ["input[name='email'], #email", profile.identity.email, "Email"],
      ["input[name='phone'], #phone", profile.identity.phone, "Phone"],
      ["input[name*='org' i], input[name*='company' i]", profile.experience.current_company, "Current company"],
      ["input[name*='linkedin' i], input[name*='urls' i]", profile.identity.linkedin, "LinkedIn"],
      ["input[name*='github' i]", profile.identity.github, "GitHub"],
    ];

    for (const [sel, value, label] of named) {
      if (!value) continue;
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      await waitIfPaused(ctx);
      try {
        await typeFill(loc, value, ctx.typingDelayMs);
        const o: FieldOutcome = { label, value, confidence: "filled", required: true };
        outcomes.push(o);
        ctx.onField(o);
      } catch {
        /* continue */
      }
    }

    if (ctx.resumePath) {
      const uploaded = await uploadFirstMatching(page, ["input[name='resume']", "input[type='file']"], ctx.resumePath);
      const o: FieldOutcome = { label: "Resume", value: ctx.resumePath, confidence: uploaded ? "filled" : "blocked", required: true };
      outcomes.push(o);
      ctx.onField(o);
    }

    // Text inputs / textareas only. Do not auto-click checkbox/radio — that can trip hCaptcha on Lever.
    const extras = page.locator("input[type='text'], input[type='email'], input[type='tel'], input[type='url'], textarea");
    const n = await extras.count();
    for (let i = 0; i < n; i++) {
      const loc = extras.nth(i);
      if (!(await loc.isVisible().catch(() => false))) continue;
      const current = await loc.inputValue().catch(() => "");
      if (current.trim()) continue;
      const label = await fieldDescriptor(page, loc);
      const mapped = lookupValue(label, ctx.profile, ctx.answers);
      if (!mapped.value || mapped.knockout && mapped.confidence === "blocked") {
        const o: FieldOutcome = { label, value: "", confidence: "blocked", required: mapped.knockout };
        outcomes.push(o);
        ctx.onField(o);
        continue;
      }
      await waitIfPaused(ctx);
      await typeFill(loc, mapped.value, ctx.typingDelayMs).catch(() => undefined);
      const o: FieldOutcome = { label, value: mapped.value, confidence: mapped.confidence, required: mapped.knockout };
      outcomes.push(o);
      ctx.onField(o);
    }

    ctx.log("Lever: left checkboxes and radios for you (hCaptcha).", "warn");
    return { outcomes, pauseReason: "Lever checkboxes/radios left for review" };
  },

  async submit(page: Page) {
    const btn = page.locator("button:has-text('Submit application'), button[type='submit']").first();
    if ((await btn.count()) === 0) return false;
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    return true;
  },
};

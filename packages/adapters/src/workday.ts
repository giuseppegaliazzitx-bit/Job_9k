import type { Page } from "playwright";
import { lookupValue } from "@job9k/core";
import type { AdapterContext, AdapterResult, AtsAdapter, FieldOutcome } from "./types.js";
import { fieldDescriptor, handleDropdown, typeFill, uploadFirstMatching, waitIfPaused } from "./fields.js";

async function pageLooksLikeGate(page: Page): Promise<string | null> {
  const url = page.url();
  const text = (await page.locator("body").innerText().catch(() => "")) ?? "";
  if (/captcha|hcaptcha|recaptcha/i.test(text) || (await page.locator("iframe[src*='captcha'], iframe[src*='hcaptcha']").count()) > 0) {
    return "CAPTCHA";
  }
  if (
    /create account|sign in|new user/i.test(text) &&
    (await page.locator('input[type="password"], input[data-automation-id="password"], input[data-automation-id="email"]').count()) > 0
  ) {
    return "login or create-account";
  }
  if (/signIn|login/i.test(url) && (await page.locator('input[type="password"]').count()) > 0) {
    return "login";
  }
  return null;
}

export const workdayAdapter: AtsAdapter = {
  ats: "workday",
  allowsAutoSubmit: false,

  async detect(url, page) {
    if (/myworkdayjobs\.com|workday/i.test(url)) return true;
    return (await page.locator("[data-automation-id]").count()) > 3;
  },

  async navigateToForm(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const apply = page.locator('[data-automation-id="jobPostingApplyButton"], button:has-text("Apply"), a:has-text("Apply")').first();
    if ((await apply.count()) > 0) {
      await apply.click().catch(() => undefined);
      await page.waitForTimeout(1500);
    }
    return page.url();
  },

  async fill(ctx: AdapterContext): Promise<AdapterResult> {
    const { page, profile } = ctx;
    const outcomes: FieldOutcome[] = [];
    const maxPages = 8;

    for (let step = 0; step < maxPages; step++) {
      const gate = await pageLooksLikeGate(page);
      if (gate) {
        ctx.log(`Workday paused: ${gate}. Persistent browser profile is kept so you can sign in.`, "warn");
        return { outcomes, pauseReason: gate, loginOrCaptcha: true };
      }

      await waitIfPaused(ctx);

      const first = page.locator('[data-automation-id="legalNameSection_firstName"], input[id*="firstName" i]').first();
      if ((await first.count()) > 0 && profile.identity.first_name) {
        await typeFill(first, profile.identity.first_name, ctx.typingDelayMs).catch(() => undefined);
        const o: FieldOutcome = { label: "First name", value: profile.identity.first_name, confidence: "filled", required: true };
        outcomes.push(o);
        ctx.onField(o);
      }
      const last = page.locator('[data-automation-id="legalNameSection_lastName"], input[id*="lastName" i]').first();
      if ((await last.count()) > 0 && profile.identity.last_name) {
        await typeFill(last, profile.identity.last_name, ctx.typingDelayMs).catch(() => undefined);
        const o: FieldOutcome = { label: "Last name", value: profile.identity.last_name, confidence: "filled", required: true };
        outcomes.push(o);
        ctx.onField(o);
      }
      const email = page.locator('[data-automation-id="email"], input[type="email"]').first();
      if ((await email.count()) > 0 && profile.identity.email) {
        await typeFill(email, profile.identity.email, ctx.typingDelayMs).catch(() => undefined);
        const o: FieldOutcome = { label: "Email", value: profile.identity.email, confidence: "filled", required: true };
        outcomes.push(o);
        ctx.onField(o);
      }
      const phone = page.locator('[data-automation-id="phone"], input[type="tel"]').first();
      if ((await phone.count()) > 0 && profile.identity.phone) {
        await typeFill(phone, profile.identity.phone, ctx.typingDelayMs).catch(() => undefined);
        const o: FieldOutcome = { label: "Phone", value: profile.identity.phone, confidence: "filled", required: true };
        outcomes.push(o);
        ctx.onField(o);
      }

      if (ctx.resumePath) {
        await uploadFirstMatching(
          page,
          ['[data-automation-id="file-upload-input-ref"]', "input[type='file']"],
          ctx.resumePath,
        );
      }

      const inputs = page.locator("input:not([type='hidden']):not([type='file']):not([type='password']), textarea, select, [data-automation-id*='selectWidget']");
      const n = Math.min(await inputs.count(), 40);
      for (let i = 0; i < n; i++) {
        const loc = inputs.nth(i);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const current = await loc.inputValue().catch(() => "");
        if (current.trim()) continue;
        const label = await fieldDescriptor(page, loc);
        const mapped = lookupValue(label, ctx.profile, ctx.answers);
        if (!mapped.value) {
          if (mapped.knockout) {
            const o: FieldOutcome = { label, value: "", confidence: "blocked", required: true };
            outcomes.push(o);
            ctx.onField(o);
          }
          continue;
        }
        await waitIfPaused(ctx);
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
        if (tag === "select") {
          await loc.selectOption({ label: mapped.value }).catch(() => loc.selectOption({ value: mapped.value }).catch(() => undefined));
        } else if ((await loc.getAttribute("aria-haspopup")) || (await loc.getAttribute("data-automation-id"))?.includes("select")) {
          await handleDropdown(page, loc, mapped.value);
        } else {
          await typeFill(loc, mapped.value, ctx.typingDelayMs).catch(() => undefined);
        }
        const o: FieldOutcome = { label, value: mapped.value, confidence: mapped.confidence, required: mapped.knockout };
        outcomes.push(o);
        ctx.onField(o);
      }

      // Fill structured experience if a work-experience widget is present.
      const addExp = page.locator('[data-automation-id*="addWorkExperience"], button:has-text("Add")').first();
      if ((await addExp.count()) > 0 && profile.experience.roles[0] && step === 0) {
        ctx.log("Workday experience widget present — filling first role from profile JSON only.");
      }

      const next = page.locator(
        '[data-automation-id="bottom-navigation-next-button"], button:has-text("Next"), button:has-text("Continue"), button:has-text("Save and Continue")',
      ).first();
      if ((await next.count()) === 0 || !(await next.isEnabled().catch(() => false))) break;
      // Stop before a button that says Submit.
      const label = ((await next.textContent()) ?? "").trim();
      if (/submit/i.test(label)) {
        ctx.log("Workday: stopping before Submit.");
        break;
      }
      await next.click().catch(() => undefined);
      await page.waitForTimeout(1500);
    }

    return { outcomes, pauseReason: "Workday wizard — review remaining steps. No auto-submit." };
  },
};

import type { Locator, Page } from "playwright";
import { lookupValue } from "@job9k/core";
import type { AdapterContext, AdapterResult, AtsAdapter, FieldOutcome } from "./types.js";
import { fieldDescriptor, fillSelectOrDropdown, sleep, typeFill, uploadFirstMatching, waitIfPaused } from "./fields.js";

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
      if (gate === "CAPTCHA") {
        ctx.log("Workday paused: CAPTCHA. Complete it in the browser, then resume.", "warn");
        return { outcomes, pauseReason: gate, loginOrCaptcha: true };
      }
      if (gate) {
        const unlocked = await unlockWorkday(page, ctx);
        if (!unlocked) {
          ctx.log(`Workday paused: ${gate}. Sign in or create the account in the browser, then resume.`, "warn");
          return { outcomes, pauseReason: gate, loginOrCaptcha: true };
        }
        await sleep(1200);
        continue;
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
        if (tag === "select" || (await loc.getAttribute("aria-haspopup")) || (await loc.getAttribute("data-automation-id"))?.includes("select")) {
          await fillSelectOrDropdown(page, loc, mapped.value);
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

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  const loc = await firstVisible(page, selectors);
  if (!loc) return false;
  await loc.click().catch(() => undefined);
  await sleep(900);
  return true;
}

async function fillVisible(page: Page, selectors: string[], value: string, delay: number): Promise<boolean> {
  const loc = await firstVisible(page, selectors);
  if (!loc || !value) return false;
  await typeFill(loc, value, delay).catch(async () => {
    await loc.fill(value).catch(() => undefined);
  });
  await sleep(250);
  return true;
}

async function stillOnAuth(page: Page): Promise<boolean> {
  const gate = await pageLooksLikeGate(page);
  return gate === "login" || gate === "login or create-account";
}

async function enterWorkdayOtp(page: Page, ctx: AdapterContext, since: number): Promise<boolean> {
  if (!ctx.waitForOtp) return false;
  ctx.log("Workday asked for a verification code. Checking Gmail…");
  const code = await ctx.waitForOtp(since);
  if (!code) {
    ctx.log("No verification code arrived in Gmail.", "warn");
    return false;
  }
  const input = await firstVisible(page, [
    'input[data-automation-id*="code" i]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[placeholder*="code" i]',
    'input[autocomplete="one-time-code"]',
    'input[type="text"]',
  ]);
  if (!input) return false;
  await typeFill(input, code, ctx.typingDelayMs).catch(async () => {
    await input.fill(code).catch(() => undefined);
  });
  await clickFirst(page, [
    'button:has-text("Verify")',
    'button:has-text("Confirm")',
    'button:has-text("Continue")',
    'button[data-automation-id="signInSubmitButton"]',
    'button[type="submit"]',
  ]);
  ctx.log("Entered Workday verification code from Gmail.");
  await sleep(1500);
  return !(await stillOnAuth(page));
}

async function workdaySignIn(page: Page, ctx: AdapterContext, email: string, password: string): Promise<boolean> {
  ctx.log("Signing into Workday with stored credentials.");
  await fillVisible(page, ['input[data-automation-id="email"]', 'input[data-automation-id="userName"]', 'input[type="email"]', 'input[name="email"]'], email, ctx.typingDelayMs);
  let pwd = await firstVisible(page, ['input[data-automation-id="password"]', 'input[type="password"]']);
  if (!pwd) {
    await clickFirst(page, ['button:has-text("Next")', 'button:has-text("Continue")']);
    pwd = await firstVisible(page, ['input[data-automation-id="password"]', 'input[type="password"]']);
  }
  if (pwd) {
    await typeFill(pwd, password, ctx.typingDelayMs).catch(async () => {
      await pwd!.fill(password).catch(() => undefined);
    });
    await sleep(250);
  }
  const since = Date.now();
  await clickFirst(page, ['button[data-automation-id="signInSubmitButton"]', 'button:has-text("Sign In")', 'button:has-text("Sign in")', 'button[type="submit"]']);
  await sleep(2000);
  const body = (await page.locator("body").innerText().catch(() => "")) ?? "";
  if (/verif|code was sent|check your email/i.test(body)) {
    return enterWorkdayOtp(page, ctx, since);
  }
  return !(await stillOnAuth(page));
}

async function workdayCreateAccount(page: Page, ctx: AdapterContext, email: string, password: string): Promise<boolean> {
  const opened = await clickFirst(page, [
    'a[data-automation-id="createAccountLink"]',
    'a:has-text("Create Account")',
    'button:has-text("Create Account")',
    'a:has-text("New User")',
    'a:has-text("Sign Up")',
    'button:has-text("Sign Up")',
  ]);
  if (!opened) return false;
  ctx.log("Creating a Workday account with stored credentials.");
  await fillVisible(page, ['input[type="email"]', 'input[data-automation-id="email"]', 'input[name="email"]'], email, ctx.typingDelayMs);
  const pwds = page.locator('input[type="password"]:visible');
  const n = await pwds.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    await pwds.nth(i).fill(password).catch(() => undefined);
    await sleep(150);
  }
  const terms = page.locator('input[type="checkbox"][data-automation-id*="agree" i], input[type="checkbox"][name*="agree" i], label:has-text("agree") input[type="checkbox"]').first();
  if ((await terms.count()) > 0 && !(await terms.isChecked().catch(() => false))) {
    await terms.click().catch(() => undefined);
  }
  const since = Date.now();
  await clickFirst(page, ['button:has-text("Create Account")', 'button:has-text("Create")', 'button:has-text("Sign Up")', 'button[type="submit"]']);
  await sleep(2000);
  const body = (await page.locator("body").innerText().catch(() => "")) ?? "";
  if (/verif|code was sent|check your email/i.test(body)) {
    return enterWorkdayOtp(page, ctx, since);
  }
  if (await stillOnAuth(page)) return workdaySignIn(page, ctx, email, password);
  return true;
}

async function unlockWorkday(page: Page, ctx: AdapterContext): Promise<boolean> {
  const email = ctx.accounts?.workday?.email?.trim() || ctx.profile.identity.email.trim();
  const password = ctx.accounts?.workday?.password ?? "";
  if (!email || !password) {
    ctx.log("No Workday email/password in Settings → Credentials.", "warn");
    return false;
  }
  if (await workdaySignIn(page, ctx, email, password)) return true;
  if (await workdayCreateAccount(page, ctx, email, password)) return true;
  return false;
}

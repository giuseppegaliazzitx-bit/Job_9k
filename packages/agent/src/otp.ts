import { ImapFlow } from "imapflow";
import type { Page } from "playwright";
import { extractOTP, looksLikeOtpPrompt, otpConfigured, type Settings } from "@job9k/core";
import { sleep, typeFill } from "@job9k/adapters";

export async function fetchOTPFromGmail(settings: Settings, sinceTimestamp?: number): Promise<string | null> {
  if (!otpConfigured(settings)) return null;
  const client = new ImapFlow({
    host: settings.otp.host || "imap.gmail.com",
    port: settings.otp.port || 993,
    secure: true,
    auth: {
      user: settings.otp.email.trim(),
      pass: settings.otp.app_password.replace(/\s+/g, ""),
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 5 * 60 * 1000);
      const messages: Array<{ envelope?: { date?: Date; from?: Array<{ address?: string }>; subject?: string }; source?: Buffer }> = [];
      for await (const msg of client.fetch({ since }, { envelope: true, source: true }, { uid: true })) {
        messages.push(msg);
      }
      messages.sort((a, b) => (b.envelope?.date?.getTime() || 0) - (a.envelope?.date?.getTime() || 0));
      for (const msg of messages.slice(0, 6)) {
        if (sinceTimestamp && msg.envelope?.date && msg.envelope.date.getTime() < sinceTimestamp - 120000) continue;
        const source = msg.source?.toString() || "";
        const text = source
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        const otp = extractOTP(text);
        if (otp) return otp;
      }
      return null;
    } finally {
      lock.release();
    }
  } catch {
    return null;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function pollGmailOtp(settings: Settings, sinceTimestamp?: number, onWait?: (elapsedSec: number) => void): Promise<string | null> {
  if (!otpConfigured(settings)) return null;
  const budget = Math.max(15, settings.otp.max_wait_sec || 90) * 1000;
  const started = Date.now();
  let round = 0;
  while (Date.now() - started < budget) {
    const code = await fetchOTPFromGmail(settings, sinceTimestamp);
    if (code) return code;
    round += 1;
    const elapsed = Math.round((Date.now() - started) / 1000);
    onWait?.(elapsed);
    await sleep(5000);
    if (round > 30) break;
  }
  return null;
}

export async function enterOtpCode(page: Page, code: string, typingDelayMs = 40): Promise<boolean> {
  const boxes = page.locator('input[maxlength="1"]:visible');
  const boxCount = await boxes.count().catch(() => 0);
  if ((boxCount === 4 || boxCount === 6 || boxCount === 8) && code.length >= boxCount) {
    for (let i = 0; i < boxCount; i++) {
      await boxes.nth(i).click().catch(() => undefined);
      await boxes.nth(i).fill(code[i] ?? "").catch(() => undefined);
    }
    return true;
  }

  const selectors = [
    'input[name*="verification" i]',
    'input[name*="code" i]',
    'input[id*="verification" i]',
    'input[id*="code" i]',
    'input[placeholder*="code" i]',
    'input[placeholder*="verification" i]',
    'input[aria-label*="verification" i]',
    'input[aria-label*="code" i]',
    'input[data-automation-id*="code" i]',
    'input[autocomplete="one-time-code"]',
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await typeFill(loc, code, typingDelayMs).catch(async () => {
      await loc.fill(code).catch(() => undefined);
    });
    return true;
  }

  const inputs = page.locator('input[type="text"]:visible, input:not([type]):visible');
  const n = Math.min(await inputs.count().catch(() => 0), 12);
  for (let i = 0; i < n; i++) {
    const loc = inputs.nth(i);
    const val = await loc.inputValue().catch(() => "x");
    if (val.trim()) continue;
    const type = ((await loc.getAttribute("type")) ?? "").toLowerCase();
    const role = ((await loc.getAttribute("role")) ?? "").toLowerCase();
    const id = ((await loc.getAttribute("id")) ?? "").toLowerCase();
    if (type === "search" || type === "tel" || role === "combobox") continue;
    if (/search|phone|country|select/.test(id)) continue;
    await typeFill(loc, code, typingDelayMs).catch(async () => {
      await loc.fill(code).catch(() => undefined);
    });
    return true;
  }
  return false;
}

export async function handleOtpOnPage(
  page: Page,
  settings: Settings,
  opts?: { sinceTimestamp?: number; typingDelayMs?: number; log?: (m: string) => void },
): Promise<"none" | "entered" | "prompt-no-code" | "code-no-input"> {
  const body = (await page.locator("body").innerText().catch(() => "")) ?? "";
  if (!looksLikeOtpPrompt(body)) return "none";
  if (!otpConfigured(settings)) {
    opts?.log?.("Verification code prompt detected, but OTP IMAP is not enabled in Settings.");
    return "prompt-no-code";
  }
  opts?.log?.("Verification code prompt detected. Checking Gmail…");
  const code = await pollGmailOtp(settings, opts?.sinceTimestamp, (elapsed) => {
    opts?.log?.(`Waiting for verification email (${elapsed}s)`);
  });
  if (!code) {
    opts?.log?.("Timed out waiting for a verification email.");
    return "prompt-no-code";
  }
  const ok = await enterOtpCode(page, code, opts?.typingDelayMs);
  if (!ok) {
    opts?.log?.("Got a verification code from email but could not find the input.");
    return "code-no-input";
  }
  const confirm = page.locator('button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Continue"), button[type="submit"]').first();
  if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
    const label = ((await confirm.textContent()) ?? "").trim();
    if (!/submit application/i.test(label)) {
      await confirm.click().catch(() => undefined);
      await sleep(1500);
    }
  }
  opts?.log?.("Entered verification code from Gmail.");
  return "entered";
}

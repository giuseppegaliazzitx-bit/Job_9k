import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getDataDir, type Settings } from "@job9k/core";

let context: BrowserContext | null = null;

export async function getContext(settings: Settings, dataDir = getDataDir()): Promise<BrowserContext> {
  if (context) return context;
  context = await chromium.launchPersistentContext(resolve(dataDir, "browser-profile"), {
    headless: !settings.browser.headed,
    slowMo: settings.browser.slow_mo_ms,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return context;
}

export async function newPage(settings: Settings, dataDir = getDataDir()): Promise<Page> {
  const ctx = await getContext(settings, dataDir);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return page;
}

export async function closeBrowser(): Promise<void> {
  await context?.close();
  context = null;
}

export function hasOpenContext(): boolean {
  return !!context;
}

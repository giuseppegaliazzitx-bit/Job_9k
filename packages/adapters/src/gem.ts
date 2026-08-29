import type { Page } from "playwright";
import type { AtsAdapter } from "./types.js";
import { genericAdapter } from "./generic.js";
import { clickApplyIfPresent } from "./fields.js";

export const gemAdapter: AtsAdapter = {
  ...genericAdapter,
  ats: "gem",
  allowsAutoSubmit: false,
  async detect(url, page) {
    if (/jobs\.gem\.com|\.gem\.com/i.test(url)) return true;
    return (await page.getByText("Powered by Gem").count()) > 0;
  },
  async navigateToForm(page: Page, url: string) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await clickApplyIfPresent(page);
    return page.url();
  },
};

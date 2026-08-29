import type { AtsAdapter } from "./types.js";
import { genericAdapter } from "./generic.js";

export const icimsAdapter: AtsAdapter = {
  ...genericAdapter,
  ats: "icims",
  allowsAutoSubmit: false,
  async detect(url, page) {
    if (/icims\.com/i.test(url)) return true;
    return (await page.locator(".iCIMS_MainWrapper").count()) > 0;
  },
};

export const smartRecruitersAdapter: AtsAdapter = {
  ...genericAdapter,
  ats: "smartrecruiters",
  allowsAutoSubmit: false,
  async detect(url, page) {
    if (/smartrecruiters\.com/i.test(url)) return true;
    return (await page.getByText("Powered by SmartRecruiters").count()) > 0;
  },
};

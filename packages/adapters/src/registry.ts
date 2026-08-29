import type { Page } from "playwright";
import { detectAtsFromHtml, detectAtsFromUrl, type AtsType } from "@job9k/core";
import { ashbyAdapter } from "./ashby.js";
import { gemAdapter } from "./gem.js";
import { genericAdapter } from "./generic.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { icimsAdapter, smartRecruitersAdapter } from "./icims.js";
import { leverAdapter } from "./lever.js";
import { workdayAdapter } from "./workday.js";
import type { AtsAdapter } from "./types.js";

const ADAPTERS: AtsAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workdayAdapter,
  gemAdapter,
  icimsAdapter,
  smartRecruitersAdapter,
  genericAdapter,
];

export function adapterFor(ats: AtsType): AtsAdapter {
  return ADAPTERS.find((a) => a.ats === ats) ?? genericAdapter;
}

export async function resolveAdapter(url: string, page?: Page): Promise<AtsAdapter> {
  const fromUrl = detectAtsFromUrl(url);
  if (fromUrl.ats !== "custom") return adapterFor(fromUrl.ats);
  if (!page) return genericAdapter;
  const html = await page.content().catch(() => "");
  const fromDom = detectAtsFromHtml(html);
  if (fromDom && fromDom.ats !== "custom") return adapterFor(fromDom.ats);
  for (const adapter of ADAPTERS) {
    if (adapter.ats === "custom") continue;
    if (await adapter.detect(url, page).catch(() => false)) return adapter;
  }
  return genericAdapter;
}

export { ADAPTERS };

import type { AtsDetection, AtsType } from "./types.js";

interface Pattern {
  ats: AtsType;
  tests: RegExp[];
  companyFromPath?: (parts: string[]) => string;
}

const URL_PATTERNS: Pattern[] = [
  {
    ats: "greenhouse",
    tests: [
      /job-boards\.greenhouse\.io/i,
      /boards\.greenhouse\.io/i,
      /greenhouse\.io\/.*\/jobs\//i,
    ],
    companyFromPath: (parts) => parts[0] ?? "",
  },
  {
    ats: "lever",
    tests: [/jobs\.lever\.co/i, /lever\.co\/.*\/apply/i],
    companyFromPath: (parts) => parts[0] ?? "",
  },
  {
    ats: "ashby",
    tests: [/jobs\.ashbyhq\.com/i, /ashbyhq\.com/i],
    companyFromPath: (parts) => parts[0] ?? "",
  },
  {
    ats: "workday",
    tests: [/myworkdayjobs\.com/i, /wd[1-5]\.myworkdayjobs\.com/i, /workday\.com\/.*job/i],
    companyFromPath: () => "",
  },
  {
    ats: "gem",
    tests: [/jobs\.gem\.com/i, /\.gem\.com/i],
    companyFromPath: (parts) => parts[0] ?? "",
  },
  {
    ats: "icims",
    tests: [/\.icims\.com/i, /icims\.com/i],
  },
  {
    ats: "smartrecruiters",
    tests: [/jobs\.smartrecruiters\.com/i, /smartrecruiters\.com/i],
    companyFromPath: (parts) => parts[0] ?? "",
  },
];

export const DOM_FINGERPRINTS: Array<{ ats: AtsType; selectors: string[] }> = [
  { ats: "greenhouse", selectors: ["#application_form", "#app_body", "text=Powered by Greenhouse"] },
  { ats: "lever", selectors: [".lever-application-form", ".application-form", "text=Powered by Lever"] },
  { ats: "ashby", selectors: ['[data-testid="ashby-job-posting"]', "text=Powered by Ashby"] },
  { ats: "workday", selectors: ['[data-automation-id]', "text=Powered by Workday"] },
  { ats: "icims", selectors: [".iCIMS_MainWrapper"] },
  { ats: "smartrecruiters", selectors: ['[data-test="header-smartrecruiters"]', "text=Powered by SmartRecruiters"] },
  { ats: "gem", selectors: ["text=Powered by Gem"] },
];

export function detectAtsFromUrl(url: string): AtsDetection {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ats: "custom", confidence: 0, companyHint: "" };
  }

  const parts = parsed.pathname.split("/").filter(Boolean);

  for (const pattern of URL_PATTERNS) {
    if (pattern.tests.some((re) => re.test(url))) {
      let companyHint = pattern.companyFromPath?.(parts) ?? "";
      if (pattern.ats === "workday") {
        const host = parsed.hostname.replace(/^www\./, "");
        companyHint = host.split(".")[0] ?? "";
      }
      if (pattern.ats === "icims") {
        companyHint = parsed.hostname.split(".")[0] ?? "";
      }
      return { ats: pattern.ats, confidence: 0.95, companyHint: prettify(companyHint) };
    }
  }

  return {
    ats: "custom",
    confidence: 0,
    companyHint: prettify(parsed.hostname.replace(/^www\./, "").split(".")[0] ?? ""),
  };
}

export function detectAtsFromHtml(html: string): AtsDetection | null {
  const lower = html.toLowerCase();
  const checks: Array<{ ats: AtsType; needles: string[] }> = [
    { ats: "greenhouse", needles: ["powered by greenhouse", "id=\"application_form\"", "greenhouse.io"] },
    { ats: "lever", needles: ["powered by lever", "lever-application-form", "jobs.lever.co"] },
    { ats: "ashby", needles: ["powered by ashby", "ashby-job-posting", "ashbyhq"] },
    { ats: "workday", needles: ["powered by workday", "data-automation-id", "myworkdayjobs"] },
    { ats: "icims", needles: ["icims_mainwrapper", "icims.com"] },
    { ats: "smartrecruiters", needles: ["powered by smartrecruiters", "smartrecruiters"] },
    { ats: "gem", needles: ["powered by gem", "jobs.gem.com"] },
  ];
  for (const check of checks) {
    if (check.needles.some((n) => lower.includes(n))) {
      return { ats: check.ats, confidence: 0.85, companyHint: "" };
    }
  }
  return null;
}

function prettify(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function parsePastedUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/[\n\r,]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let url = trimmed;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const normalized = new URL(url).toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      // skip invalid
    }
  }
  return out;
}

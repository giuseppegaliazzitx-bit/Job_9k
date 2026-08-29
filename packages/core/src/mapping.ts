import type { AnswerBank, FieldConfidence, Profile } from "./types.js";
import { KNOCKOUT_PATTERNS } from "./types.js";

export interface MappedValue {
  value: string;
  confidence: FieldConfidence;
  source: "profile" | "answers" | "none";
  knockout: boolean;
}

export function isKnockoutLabel(label: string): boolean {
  return KNOCKOUT_PATTERNS.some((re) => re.test(label));
}

export function fuzzyScore(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.includes(x) || x.includes(y)) return 0.8;
  const aw = x.split(/[\s_\-]+/).filter(Boolean);
  const bw = y.split(/[\s_\-]+/).filter(Boolean);
  if (!aw.length || !bw.length) return 0;
  const overlap = aw.filter((w) => bw.some((v) => v.includes(w) || w.includes(v)));
  return (overlap.length / Math.max(aw.length, bw.length)) * 0.6;
}

type Getter = (p: Profile, answers: AnswerBank) => string;

const FIELD_GETTERS: Array<{ patterns: RegExp[]; get: Getter; knockout?: boolean }> = [
  { patterns: [/first[\s_-]*name/i, /preferred[\s_-]*name/i, /given[\s_-]*name/i], get: (p) => p.identity.preferred_name || p.identity.first_name },
  { patterns: [/last[\s_-]*name/i, /surname/i, /family[\s_-]*name/i], get: (p) => p.identity.last_name },
  { patterns: [/full[\s_-]*name/i, /^name$/i], get: (p) => `${p.identity.first_name} ${p.identity.last_name}`.trim() },
  { patterns: [/e[\s_-]*mail/i], get: (p) => p.identity.email },
  { patterns: [/phone/i, /mobile/i, /telephone/i, /cell/i], get: (p) => p.identity.phone },
  { patterns: [/linkedin/i], get: (p) => p.identity.linkedin },
  { patterns: [/github/i], get: (p) => p.identity.github },
  { patterns: [/website/i, /portfolio/i, /personal[\s_-]*url/i], get: (p) => p.identity.portfolio },
  { patterns: [/^city$/i], get: (p) => p.identity.city },
  { patterns: [/^state$/i, /province/i], get: (p) => p.identity.state },
  { patterns: [/zip/i, /postal/i], get: (p) => p.identity.postal_code },
  { patterns: [/^country$/i], get: (p) => p.identity.country },
  { patterns: [/address[\s_-]*line[\s_-]*1/i, /^address$/i], get: (p) => p.identity.address_line1 || p.identity.location },
  { patterns: [/location/i], get: (p) => p.identity.location },
  { patterns: [/sponsor/i, /visa/i], get: (p) => p.identity.sponsorship_needed || p.work_auth.sponsorship_needed, knockout: true },
  { patterns: [/authorized/i, /work.?auth/i, /legally.{0,20}work/i, /eligible.{0,20}work/i], get: (p) => p.identity.work_auth || p.work_auth.authorized_us, knockout: true },
  { patterns: [/years?.{0,24}experience/i], get: (p) => p.experience.years, knockout: true },
  { patterns: [/salary/i, /compensation/i, /expected pay/i], get: (p) => p.experience.salary_expectation, knockout: true },
  { patterns: [/clearance/i], get: (_p, a) => a.security_clearance ?? "", knockout: true },
  { patterns: [/notice[\s_-]*period/i, /start[\s_-]*date/i, /availab/i], get: (p) => p.experience.notice_period },
  { patterns: [/current[\s_-]*(company|employer)/i], get: (p) => p.experience.current_company },
  { patterns: [/current[\s_-]*(title|role|position)/i], get: (p) => p.experience.current_title },
  { patterns: [/university/i, /school/i, /college/i, /institution/i], get: (p) => p.education[0]?.school ?? "" },
  { patterns: [/degree/i], get: (p) => p.education[0]?.degree ?? "" },
  { patterns: [/major/i, /field[\s_-]*of[\s_-]*study/i], get: (p) => p.education[0]?.major ?? "" },
  { patterns: [/gender/i], get: (p) => p.eeo.gender },
  { patterns: [/hispanic|latino/i], get: (p) => p.eeo.hispanic_latino },
  { patterns: [/race|ethnicity/i], get: (p) => p.eeo.race },
  { patterns: [/veteran/i], get: (p) => p.eeo.veteran_status },
  { patterns: [/disability/i], get: (p) => p.eeo.disability_status },
  { patterns: [/relocat/i], get: (p) => p.work_auth.willing_to_relocate },
  { patterns: [/office|on-?site|in-?person|hybrid/i], get: (p) => p.work_auth.office_willing },
  { patterns: [/how[\s_-]*did[\s_-]*you[\s_-]*hear|referral|source/i], get: (_p, a) => a.how_heard || "Job Boards" },
];

export function lookupValue(label: string, profile: Profile, answers: AnswerBank): MappedValue {
  const knockout = isKnockoutLabel(label);
  const cleaned = label.replace(/\*+/g, "").trim();

  for (const entry of FIELD_GETTERS) {
    if (entry.patterns.some((re) => re.test(cleaned))) {
      const value = entry.get(profile, answers)?.trim() ?? "";
      if (value) {
        return {
          value,
          confidence: "filled",
          source: "profile",
          knockout: knockout || !!entry.knockout,
        };
      }
      if (knockout || entry.knockout) {
        return { value: "", confidence: "blocked", source: "none", knockout: true };
      }
    }
  }

  let bestKey = "";
  let best = 0;
  for (const key of Object.keys(answers)) {
    const score = Math.max(fuzzyScore(cleaned, key), fuzzyScore(cleaned, key.replace(/_/g, " ")));
    if (score > best) {
      best = score;
      bestKey = key;
    }
  }
  if (bestKey && best >= 0.5 && answers[bestKey]?.trim()) {
    if (knockout && best < 0.8) {
      return { value: "", confidence: "blocked", source: "none", knockout: true };
    }
    return {
      value: answers[bestKey],
      confidence: best >= 0.8 ? "filled" : "guessed",
      source: "answers",
      knockout,
    };
  }

  if (knockout) {
    return { value: "", confidence: "blocked", source: "none", knockout: true };
  }

  return { value: "", confidence: "blocked", source: "none", knockout: false };
}

export function companyBlacklisted(company: string, profile: Profile): boolean {
  const c = company.toLowerCase();
  return profile.blacklist.some((b) => c.includes(b.toLowerCase()) || b.toLowerCase().includes(c));
}

export function keywordFitScore(jd: string, profile: Profile): number | null {
  if (!jd || profile.skills.length === 0) return null;
  const text = jd.toLowerCase();
  const hits = profile.skills.filter((s) => text.includes(s.toLowerCase())).length;
  const ratio = hits / profile.skills.length;
  const score = Math.max(1, Math.min(5, Math.round(1 + ratio * 4)));
  return score;
}

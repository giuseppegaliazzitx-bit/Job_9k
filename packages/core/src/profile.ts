import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { AnswerBank, Profile, Settings } from "./types.js";
import { getDataDir, getRepoRoot, resolveData } from "./paths.js";

export const SECRET_PLACEHOLDER = "********";

const DEFAULT_SETTINGS: Settings = {
  browser: { headed: true, slow_mo_ms: 50, typing_delay_ms: 40 },
  auto_submit: { enabled: false, allowlist: ["greenhouse", "lever"] },
  llm: {
    provider: "none",
    base_url: "https://api.x.ai/v1",
    model: "grok-4.6",
    api_key_env: "XAI_API_KEY",
  },
  otp: {
    enabled: false,
    email: "",
    app_password: "",
    host: "imap.gmail.com",
    port: 993,
    max_wait_sec: 90,
  },
  accounts: {
    workday: { email: "", password: "" },
  },
  data_dir: "./data",
};

function ensureFromExample(dest: string, exampleRel: string): void {
  if (existsSync(dest)) return;
  const example = resolve(getRepoRoot(), exampleRel);
  if (existsSync(example)) copyFileSync(example, dest);
}

export function loadProfile(dataDir = getDataDir()): Profile {
  const path = resolveData(dataDir, "profile.yml");
  ensureFromExample(path, "data/profile.example.yml");
  const raw = yaml.load(readFileSync(path, "utf8")) as Profile;
  return normalizeProfile(raw);
}

export function saveProfile(profile: Profile, dataDir = getDataDir()): void {
  const path = resolveData(dataDir, "profile.yml");
  writeFileSync(path, yaml.dump(profile, { lineWidth: 100 }), "utf8");
}

export function loadAnswers(dataDir = getDataDir()): AnswerBank {
  const path = resolveData(dataDir, "answers.yml");
  ensureFromExample(path, "data/answers.example.yml");
  if (!existsSync(path)) return {};
  const raw = yaml.load(readFileSync(path, "utf8")) as AnswerBank | null;
  const out: AnswerBank = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

export function saveAnswers(answers: AnswerBank, dataDir = getDataDir()): void {
  const path = resolveData(dataDir, "answers.yml");
  writeFileSync(path, yaml.dump(answers, { lineWidth: 100 }), "utf8");
}

function isSecretPlaceholder(value: unknown): boolean {
  const v = String(value ?? "").trim();
  return !v || v === SECRET_PLACEHOLDER;
}

export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const r = raw ?? {};
  return {
    browser: { ...DEFAULT_SETTINGS.browser, ...(r.browser ?? {}) },
    auto_submit: {
      enabled: r.auto_submit?.enabled ?? false,
      allowlist: r.auto_submit?.allowlist ?? DEFAULT_SETTINGS.auto_submit.allowlist,
    },
    llm: { ...DEFAULT_SETTINGS.llm, ...(r.llm ?? {}) },
    otp: {
      enabled: Boolean(r.otp?.enabled),
      email: r.otp?.email ?? "",
      app_password: r.otp?.app_password ?? "",
      host: r.otp?.host || DEFAULT_SETTINGS.otp.host,
      port: Number(r.otp?.port) || DEFAULT_SETTINGS.otp.port,
      max_wait_sec: Number(r.otp?.max_wait_sec) || DEFAULT_SETTINGS.otp.max_wait_sec,
    },
    accounts: {
      workday: {
        email: r.accounts?.workday?.email ?? "",
        password: r.accounts?.workday?.password ?? "",
      },
    },
    data_dir: r.data_dir ?? DEFAULT_SETTINGS.data_dir,
  };
}

export function loadSettings(dataDir = getDataDir()): Settings {
  const path = resolveData(dataDir, "settings.yml");
  ensureFromExample(path, "data/settings.example.yml");
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS, otp: { ...DEFAULT_SETTINGS.otp }, accounts: { workday: { ...DEFAULT_SETTINGS.accounts.workday } } };
  const raw = (yaml.load(readFileSync(path, "utf8")) as Partial<Settings>) ?? {};
  return normalizeSettings(raw);
}

export function mergeSettings(current: Settings, incoming: Partial<Settings>): Settings {
  const next = normalizeSettings({
    ...current,
    ...incoming,
    browser: { ...current.browser, ...(incoming.browser ?? {}) },
    auto_submit: { ...current.auto_submit, ...(incoming.auto_submit ?? {}) },
    llm: { ...current.llm, ...(incoming.llm ?? {}) },
    otp: { ...current.otp, ...(incoming.otp ?? {}) },
    accounts: {
      workday: { ...current.accounts.workday, ...(incoming.accounts?.workday ?? {}) },
    },
  });
  if (incoming.otp && isSecretPlaceholder(incoming.otp.app_password)) {
    next.otp.app_password = current.otp.app_password;
  }
  if (incoming.accounts?.workday && isSecretPlaceholder(incoming.accounts.workday.password)) {
    next.accounts.workday.password = current.accounts.workday.password;
  }
  return next;
}

export function redactSettings(settings: Settings): Settings {
  const out = normalizeSettings(settings);
  if (out.otp.app_password) out.otp.app_password = SECRET_PLACEHOLDER;
  if (out.accounts.workday.password) out.accounts.workday.password = SECRET_PLACEHOLDER;
  return out;
}

export function saveSettings(settings: Settings, dataDir = getDataDir()): void {
  const path = resolveData(dataDir, "settings.yml");
  writeFileSync(path, yaml.dump(normalizeSettings(settings), { lineWidth: 100 }), "utf8");
}

export function otpConfigured(settings: Settings): boolean {
  return Boolean(settings.otp.enabled && settings.otp.email.trim() && settings.otp.app_password.trim());
}

export function fullName(profile: Profile): string {
  return `${profile.identity.first_name} ${profile.identity.last_name}`.trim();
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

function normalizeProfile(raw: Partial<Profile> | null | undefined): Profile {
  const r = raw ?? {};
  const identity = r.identity ?? ({} as Profile["identity"]);
  const files = r.files ?? { resume: "", cover_letter: "" };
  const experience = r.experience ?? ({} as Profile["experience"]);
  const eeo = r.eeo ?? ({} as Profile["eeo"]);
  const workAuth = r.work_auth ?? ({} as Profile["work_auth"]);
  return {
    identity: {
      first_name: str(identity.first_name),
      last_name: str(identity.last_name),
      preferred_name: str(identity.preferred_name) || str(identity.first_name),
      email: str(identity.email),
      phone: str(identity.phone),
      phone_country: str(identity.phone_country),
      location: str(identity.location),
      city: str(identity.city),
      state: str(identity.state),
      postal_code: str(identity.postal_code),
      address_line1: str(identity.address_line1),
      address_line2: str(identity.address_line2),
      country: str(identity.country),
      linkedin: str(identity.linkedin),
      github: str(identity.github),
      portfolio: str(identity.portfolio),
      work_auth: str(identity.work_auth) || str(workAuth.authorized_us),
      sponsorship_needed: str(identity.sponsorship_needed) || str(workAuth.sponsorship_needed),
    },
    files: {
      resume: str(files.resume),
      cover_letter: str(files.cover_letter),
    },
    skills: Array.isArray(r.skills) ? r.skills.map(String) : [],
    experience: {
      years: str(experience.years),
      current_company: str(experience.current_company),
      current_title: str(experience.current_title),
      notice_period: str(experience.notice_period),
      salary_expectation: str(experience.salary_expectation),
      roles: Array.isArray(experience.roles) ? experience.roles : [],
    },
    education: Array.isArray(r.education) ? r.education : [],
    eeo: {
      gender: str(eeo.gender),
      hispanic_latino: str(eeo.hispanic_latino),
      race: str(eeo.race),
      veteran_status: str(eeo.veteran_status),
      disability_status: str(eeo.disability_status),
    },
    work_auth: {
      authorized_us: str(workAuth.authorized_us) || str(identity.work_auth),
      sponsorship_needed: str(workAuth.sponsorship_needed) || str(identity.sponsorship_needed),
      visa_status: str(workAuth.visa_status),
      office_willing: str(workAuth.office_willing),
      willing_to_relocate: str(workAuth.willing_to_relocate),
      remote_preference: str(workAuth.remote_preference),
    },
    blacklist: Array.isArray(r.blacklist) ? r.blacklist.map(String) : [],
  };
}

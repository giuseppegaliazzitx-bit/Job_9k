export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "gem",
  "icims",
  "smartrecruiters",
  "custom",
] as const;

export type AtsType = (typeof ATS_TYPES)[number];

export const JOB_STATUSES = [
  "queued",
  "fetching",
  "ready",
  "filling",
  "review",
  "submitted",
  "failed",
  "skipped",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type FieldConfidence = "filled" | "guessed" | "blocked";

export interface AtsDetection {
  ats: AtsType;
  confidence: number;
  companyHint: string;
}

export interface Job {
  id: string;
  url: string;
  applyUrl: string;
  company: string;
  title: string;
  ats: AtsType;
  atsConfidence: number;
  fitScore: number | null;
  status: JobStatus;
  note: string;
  lastError: string;
  jdSnippet: string;
  resumePath: string;
  coverLetterPath: string;
  autoSubmit: boolean;
  screenshotPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobEvent {
  id: number;
  jobId: string;
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
  payload: unknown;
}

export interface FieldMapRow {
  id: number;
  jobId: string;
  label: string;
  value: string;
  confidence: FieldConfidence;
  required: boolean;
  choices?: string[];
}

export interface Identity {
  first_name: string;
  last_name: string;
  preferred_name: string;
  email: string;
  phone: string;
  phone_country: string;
  location: string;
  city: string;
  state: string;
  postal_code: string;
  address_line1: string;
  address_line2: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  work_auth: string;
  sponsorship_needed: string;
}

export interface ExperienceRole {
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  bullets: string[];
}

export interface Education {
  school: string;
  degree: string;
  major: string;
  start: string;
  end: string;
}

export interface Profile {
  identity: Identity;
  files: { resume: string; cover_letter: string };
  skills: string[];
  experience: {
    years: string;
    current_company: string;
    current_title: string;
    notice_period: string;
    salary_expectation: string;
    roles: ExperienceRole[];
  };
  education: Education[];
  eeo: {
    gender: string;
    hispanic_latino: string;
    race: string;
    veteran_status: string;
    disability_status: string;
  };
  work_auth: {
    authorized_us: string;
    sponsorship_needed: string;
    visa_status: string;
    office_willing: string;
    willing_to_relocate: string;
    remote_preference: string;
  };
  blacklist: string[];
}

export type AnswerBank = Record<string, string>;

export interface OtpSettings {
  enabled: boolean;
  email: string;
  app_password: string;
  host: string;
  port: number;
  max_wait_sec: number;
}

export interface AccountCredentials {
  email: string;
  password: string;
}

export interface Settings {
  browser: {
    headed: boolean;
    slow_mo_ms: number;
    typing_delay_ms: number;
  };
  auto_submit: {
    enabled: boolean;
    allowlist: AtsType[];
  };
  llm: {
    provider: "none" | "openai-compatible" | "anthropic";
    base_url: string;
    model: string;
    api_key_env: string;
  };
  otp: OtpSettings;
  accounts: {
    workday: AccountCredentials;
  };
  data_dir: string;
}

export interface FillResult {
  status: "review" | "submitted" | "failed" | "skipped";
  fieldsFilled: FieldMapRow[];
  fieldsBlocked: FieldMapRow[];
  screenshotPath: string;
  note: string;
  error?: string;
}

export const KNOCKOUT_PATTERNS: RegExp[] = [
  /sponsor/i,
  /visa/i,
  /work.?auth/i,
  /authorized to work/i,
  /legally.{0,20}work/i,
  /eligible.{0,20}work/i,
  /years?.{0,24}experience/i,
  /salary/i,
  /compensation/i,
  /expected pay/i,
  /clearance/i,
];

export type Ats =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "gem"
  | "icims"
  | "smartrecruiters"
  | "custom";

export type JobStatus =
  | "queued"
  | "fetching"
  | "ready"
  | "filling"
  | "review"
  | "submitted"
  | "failed"
  | "skipped";

export interface Job {
  id: string;
  url: string;
  applyUrl: string;
  company: string;
  title: string;
  ats: Ats;
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
}

export interface FieldMap {
  id: number;
  jobId: string;
  label: string;
  value: string;
  confidence: "filled" | "guessed" | "blocked";
  required: boolean;
}

export interface InboxItem {
  key: string;
  label: string;
  required: boolean;
  dismissed: boolean;
  seen: number;
  firstSeen: string;
  lastSeen: string;
  lastCompany: string;
  lastTitle: string;
  lastUrl: string;
  lastJobId: string;
  sources: string[];
  choices: string[];
}

export type View = "queue" | "applied" | "review" | "failed" | "profile" | "inbox" | "answers" | "settings";

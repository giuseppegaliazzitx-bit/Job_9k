import type { Page } from "playwright";
import type { AnswerBank, AtsType, FieldConfidence, Profile } from "@job9k/core";

export interface FieldOutcome {
  label: string;
  value: string;
  confidence: FieldConfidence;
  required: boolean;
  choices?: string[];
}

export interface AdapterContext {
  page: Page;
  profile: Profile;
  answers: AnswerBank;
  resumePath: string;
  coverLetterPath: string;
  typingDelayMs: number;
  shouldPause: () => boolean;
  onField: (field: FieldOutcome) => void;
  onUnknownQuestion: (question: string, draft: string) => Promise<"skip-job" | { value: string } | "leave">;
  log: (message: string, level?: "info" | "warn" | "error") => void;
  accounts?: { workday?: { email: string; password: string } };
  waitForOtp?: (sinceTimestamp?: number) => Promise<string | null>;
}

export interface AdapterResult {
  outcomes: FieldOutcome[];
  pauseReason?: string;
  alreadyApplied?: boolean;
  loginOrCaptcha?: boolean;
}

export interface AtsAdapter {
  ats: AtsType;
  detect(url: string, page: Page): Promise<boolean>;
  navigateToForm(page: Page, url: string): Promise<string>;
  fill(ctx: AdapterContext): Promise<AdapterResult>;
  submit?(page: Page): Promise<boolean>;
  /** If false, runner must never click Submit even when auto-submit is on. */
  allowsAutoSubmit: boolean;
}

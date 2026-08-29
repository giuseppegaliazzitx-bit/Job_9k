import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  addEvent,
  companyBlacklisted,
  getDataDir,
  getJob,
  keywordFitScore,
  loadAnswers,
  loadProfile,
  loadSettings,
  logFromMaps,
  replaceFieldMaps,
  resolveMaybeRelative,
  updateJob,
  type FieldMapRow,
  type Job,
  type Settings,
} from "@job9k/core";
import { resolveAdapter, SkipJobError, extractPageMeta, type FieldOutcome } from "@job9k/adapters";
import { newPage } from "./browser.js";
import { emit } from "./events.js";
import { draftUnknownAnswer, llmEnabled, planUnknownForm, summarizeJd } from "./llm.js";

export interface ActiveRun {
  jobId: string;
  runId: string;
  paused: boolean;
  takeover: boolean;
  pendingQuestion?: {
    question: string;
    draft: string;
    resolve: (v: "skip-job" | { value: string } | "leave") => void;
  };
}

const runs = new Map<string, ActiveRun>();

export function getRun(jobId: string): ActiveRun | undefined {
  return runs.get(jobId);
}

export function pauseRun(jobId: string, paused: boolean): void {
  const r = runs.get(jobId);
  if (r) r.paused = paused;
}

export function takeoverRun(jobId: string): void {
  const r = runs.get(jobId);
  if (r) {
    r.takeover = true;
    r.paused = false;
    r.pendingQuestion?.resolve("leave");
  }
}

export function resolveQuestion(jobId: string, action: "confirm" | "edit" | "skip" | "leave", value?: string): boolean {
  const r = runs.get(jobId);
  if (!r?.pendingQuestion) return false;
  if (action === "skip") r.pendingQuestion.resolve("skip-job");
  else if (action === "leave") r.pendingQuestion.resolve("leave");
  else r.pendingQuestion.resolve({ value: value ?? r.pendingQuestion.draft });
  r.pendingQuestion = undefined;
  return true;
}

function log(job: Job, message: string, level: "info" | "warn" | "error" = "info"): void {
  addEvent(job.id, message, level);
  emit({ type: "log", jobId: job.id, message, level });
}

async function screenshot(page: import("playwright").Page, job: Job, dataDir: string, tag: string): Promise<string> {
  const path = resolve(dataDir, "screenshots", `${job.id}-${tag}-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => undefined);
  updateJob(job.id, { screenshotPath: path });
  emit({ type: "screenshot", jobId: job.id, path });
  return path;
}

let chain: Promise<unknown> = Promise.resolve();

export async function runJob(jobId: string, opts: { autoSubmit?: boolean } = {}): Promise<Job | null> {
  const run = () => runJobNow(jobId, opts);
  const done = chain.then(run, run);
  chain = done.catch(() => undefined);
  return done;
}

async function runJobNow(jobId: string, opts: { autoSubmit?: boolean } = {}): Promise<Job | null> {
  const settings = loadSettings();
  const dataDir = getDataDir(settings.data_dir);
  const profile = loadProfile(dataDir);
  const answers = loadAnswers(dataDir);
  let job = getJob(jobId);
  if (!job) return null;

  if (companyBlacklisted(job.company, profile)) {
    updateJob(job.id, { status: "skipped", note: "Company is on your blacklist" });
    return getJob(job.id);
  }

  const run: ActiveRun = { jobId, runId: jobId, paused: false, takeover: false };
  runs.set(jobId, run);

  job = updateJob(job.id, { status: "filling", lastError: "" })!;
  emit({ type: "status", jobId, status: "filling" });
  log(job, "Opening browser");

  const page = await newPage(settings, dataDir);
  const resumePath = resolveMaybeRelative(job.resumePath || profile.files.resume, dataDir);
  const coverLetterPath = resolveMaybeRelative(job.coverLetterPath || profile.files.cover_letter, dataDir);

  const outcomes: FieldOutcome[] = [];
  try {
    const adapter = await resolveAdapter(job.url, page);
    updateJob(job.id, { ats: adapter.ats, applyUrl: job.url });
    log(job, `Adapter: ${adapter.ats}`);

    const applyUrl = await adapter.navigateToForm(page, job.url);
    const meta = await extractPageMeta(page);
    let fit = keywordFitScore(meta.jd, profile);
    let snippet = meta.jd.slice(0, 500);
    if (llmEnabled(settings) && meta.jd) {
      const scored = await summarizeJd(settings, meta.jd, profile);
      snippet = scored.snippet || snippet;
      if (scored.fit) fit = scored.fit;
    }
    updateJob(job.id, {
      applyUrl,
      title: job.title || meta.title,
      jdSnippet: snippet,
      fitScore: fit,
      resumePath: existsSync(resumePath) ? resumePath : job.resumePath,
    });
    log(job, `On form: ${applyUrl}`);
    await screenshot(page, job, dataDir, "open");

    const ctx = {
      page,
      profile,
      answers,
      resumePath: existsSync(resumePath) ? resumePath : "",
      coverLetterPath: existsSync(coverLetterPath) ? coverLetterPath : "",
      typingDelayMs: settings.browser.typing_delay_ms,
      shouldPause: () => run.paused || run.takeover,
      onField: (field: FieldOutcome) => {
        outcomes.push(field);
        persistMaps(job.id, outcomes);
        emit({ type: "field", jobId: job.id, label: field.label, value: field.value, confidence: field.confidence });
      },
      onUnknownQuestion: async (question: string, draft: string) => {
        const llmDraft = draft || (await draftUnknownAnswer(settings, question, profile, answers));
        log(job, `Unknown question: ${question}`, "warn");
        emit({ type: "question", jobId: job.id, runId: run.runId, question, draft: llmDraft });
        updateJob(job.id, { status: "review", note: `Waiting on: ${question}` });
        emit({ type: "status", jobId: job.id, status: "review" });
        return await new Promise<"skip-job" | { value: string } | "leave">((resolve) => {
          run.pendingQuestion = { question, draft: llmDraft, resolve };
        }).then((v) => {
          updateJob(job.id, { status: "filling" });
          emit({ type: "status", jobId: job.id, status: "filling" });
          return v;
        });
      },
      log: (message: string, level: "info" | "warn" | "error" = "info") => log(job, message, level),
    };

    if (run.takeover) throw new Error("Take over");

    const result = await adapter.fill(ctx);

    if (adapter.ats === "custom" && llmEnabled(settings)) {
      const labels = result.outcomes.filter((o) => o.confidence === "blocked").map((o) => ({ label: o.label, type: "text" }));
      if (labels.length) {
        const plan = await planUnknownForm(settings, labels, profile, answers);
        if (plan) log(job, `Agent fallback mapped ${plan.fills.length} extra fields`);
      }
    }

    persistMaps(job.id, result.outcomes);
    const shot = await screenshot(page, job, dataDir, "filled");

    const blockedRequired = result.outcomes.filter((o) => o.required && o.confidence === "blocked");
    const wantSubmit =
      (opts.autoSubmit || job.autoSubmit) &&
      settings.auto_submit.enabled &&
      settings.auto_submit.allowlist.includes(adapter.ats) &&
      adapter.allowsAutoSubmit &&
      blockedRequired.length === 0 &&
      !result.loginOrCaptcha &&
      adapter.submit;

    let status: Job["status"] = "review";
    let note = result.pauseReason || "Filled. Review in the browser, then Submit yourself.";
    if (result.alreadyApplied) note = "Ashby warned this email may already be used. " + note;
    if (wantSubmit && adapter.submit) {
      const ok = await adapter.submit(page);
      status = ok ? "submitted" : "review";
      note = ok ? "Submitted (allowlisted ATS, all required fields mapped)." : "Submit click failed; review in browser.";
      await screenshot(page, job, dataDir, ok ? "submitted" : "submit-failed");
    }

    if (run.takeover) {
      status = "review";
      note = "You took over the browser.";
    }

    const maps = persistMaps(job.id, result.outcomes);
    logFromMaps(job.url, adapter.ats, status, maps, shot, { company: job.company, title: job.title, note });
    const updated = updateJob(job.id, { status, note, lastError: "", screenshotPath: shot, ats: adapter.ats, applyUrl })!;
    emit({ type: "status", jobId: job.id, status });
    emit({ type: "done", jobId: job.id, status });
    log(updated, `Done: ${status}`);
    return updated;
  } catch (err) {
    if (err instanceof SkipJobError) {
      const updated = updateJob(job.id, { status: "skipped", note: err.message })!;
      emit({ type: "status", jobId: job.id, status: "skipped" });
      emit({ type: "done", jobId: job.id, status: "skipped" });
      return updated;
    }
    const message = err instanceof Error ? err.message : String(err);
    const shot = await screenshot(page, job, dataDir, "failed");
    log(job, message, "error");
    logFromMaps(job.url, job.ats, "failed", persistMaps(job.id, outcomes), shot, {
      company: job.company,
      title: job.title,
      note: message,
    });
    const updated = updateJob(job.id, { status: "failed", lastError: message, screenshotPath: shot })!;
    emit({ type: "status", jobId: job.id, status: "failed" });
    emit({ type: "done", jobId: job.id, status: "failed" });
    return updated;
  } finally {
    runs.delete(jobId);
    // Leave the page open so the user can submit / take over. Do not close the persistent context.
  }
}

function persistMaps(jobId: string, outcomes: FieldOutcome[]): FieldMapRow[] {
  const rows = outcomes.map((o) => ({
    label: o.label,
    value: o.confidence === "blocked" ? "" : o.value,
    confidence: o.confidence,
    required: o.required,
  }));
  replaceFieldMaps(jobId, rows);
  return rows.map((r, i) => ({ id: i, jobId, ...r }));
}

export function getSettings(): Settings {
  return loadSettings();
}

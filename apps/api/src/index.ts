import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import {
  addEvent,
  answerInboxItems,
  detectAtsFromUrl,
  deleteJob,
  dismissInboxItems,
  getDataDir,
  getJob,
  harvestBlockedFromDb,
  insertJob,
  listEvents,
  listFieldMaps,
  listJobs,
  listPendingInbox,
  loadAnswers,
  loadProfile,
  loadSettings,
  mergeSettings,
  nextQueuedJob,
  parsePastedUrls,
  redactSettings,
  saveAnswers,
  saveProfile,
  saveSettings,
  updateJob,
  type JobStatus,
} from "@job9k/core";
import { bus, closeBrowser, getRun, pauseRun, resolveQuestion, runJob, takeoverRun } from "@job9k/agent";

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json({ limit: "2mb" }));

const dataDir = getDataDir(loadSettings().data_dir);
const upload = multer({ dest: resolve(dataDir, "resumes") });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/jobs", (req, res) => {
  const status = req.query.status as string | undefined;
  const statuses = status ? (status.split(",") as JobStatus[]) : undefined;
  res.json(listJobs(statuses));
});

app.post("/api/jobs", (req, res) => {
  const text = String(req.body?.text ?? req.body?.urls?.join?.("\n") ?? "");
  const urls = parsePastedUrls(text);
  const profile = loadProfile();
  const created = urls.map((url) => {
    const det = detectAtsFromUrl(url);
    const job = insertJob({
      url,
      ats: det.ats,
      atsConfidence: det.confidence,
      company: det.companyHint,
    });
    if (profile.blacklist.some((b) => job.company.toLowerCase().includes(b.toLowerCase()))) {
      return updateJob(job.id, { status: "skipped", note: "Blacklisted company" }) ?? job;
    }
    addEvent(job.id, "Added to queue");
    return job;
  });
  res.json({ jobs: created });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json({
    job,
    events: listEvents(job.id),
    fields: listFieldMaps(job.id),
    run: getRun(job.id) ? { paused: getRun(job.id)!.paused, pendingQuestion: getRun(job.id)!.pendingQuestion?.question } : null,
  });
});

app.patch("/api/jobs/:id", (req, res) => {
  const job = updateJob(req.params.id, req.body ?? {});
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.delete("/api/jobs/:id", (req, res) => {
  res.json({ ok: deleteJob(req.params.id) });
});

app.post("/api/jobs/:id/skip", (req, res) => {
  const job = updateJob(req.params.id, { status: "skipped", note: req.body?.note || "Skipped" });
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.post("/api/jobs/:id/fill", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  void runJob(job.id, { autoSubmit: Boolean(req.body?.autoSubmit) });
  res.json({ ok: true, jobId: job.id });
});

app.post("/api/jobs/run-next", async (_req, res) => {
  const job = nextQueuedJob();
  if (!job) return res.status(404).json({ error: "queue empty" });
  void runJob(job.id, { autoSubmit: false });
  res.json({ ok: true, jobId: job.id });
});

app.post("/api/jobs/run-selected", async (req, res) => {
  const ids: string[] = req.body?.ids ?? [];
  const autoSubmit = Boolean(req.body?.autoSubmit);
  const started: string[] = [];
  for (const id of ids) {
    if (getJob(id)) {
      started.push(id);
      void runJob(id, { autoSubmit });
    }
  }
  res.json({ ok: true, started });
});

app.post("/api/jobs/:id/pause", (req, res) => {
  pauseRun(req.params.id, req.body?.paused !== false);
  res.json({ ok: true });
});

app.post("/api/jobs/:id/takeover", (req, res) => {
  takeoverRun(req.params.id);
  res.json({ ok: true });
});

app.post("/api/jobs/:id/resolve", (req, res) => {
  const ok = resolveQuestion(req.params.id, req.body?.action, req.body?.value);
  res.json({ ok });
});

app.get("/api/profile", (_req, res) => {
  res.json(loadProfile());
});

app.put("/api/profile", (req, res) => {
  saveProfile(req.body);
  res.json(loadProfile());
});

app.get("/api/answers", (_req, res) => {
  res.json(loadAnswers());
});

app.get("/api/inbox", (_req, res) => {
  harvestBlockedFromDb(dataDir);
  const items = listPendingInbox(dataDir);
  res.json({ items, pendingCount: items.length });
});

app.post("/api/inbox/answer", (req, res) => {
  const body = req.body ?? {};
  const values =
    body.answers && typeof body.answers === "object"
      ? (body.answers as Record<string, string>)
      : body.key
        ? { [String(body.key)]: String(body.value ?? "") }
        : {};
  const items = answerInboxItems(values, dataDir);
  res.json({ items, pendingCount: items.length });
});

app.post("/api/inbox/dismiss", (req, res) => {
  const body = req.body ?? {};
  const keys: string[] = Array.isArray(body.keys) ? body.keys.map(String) : body.key ? [String(body.key)] : [];
  const items = dismissInboxItems(keys, dataDir);
  res.json({ items, pendingCount: items.length });
});

app.put("/api/answers", (req, res) => {
  saveAnswers(req.body ?? {});
  res.json(loadAnswers());
});

app.get("/api/settings", (_req, res) => {
  res.json(redactSettings(loadSettings()));
});

app.put("/api/settings", (req, res) => {
  const merged = mergeSettings(loadSettings(), req.body ?? {});
  saveSettings(merged);
  res.json(redactSettings(loadSettings()));
});

app.post("/api/files", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  const kind = req.body?.kind === "cover" ? "cover-letters" : "resumes";
  const destDir = resolve(dataDir, kind);
  mkdirSync(destDir, { recursive: true });
  const dest = resolve(destDir, req.file.originalname || req.file.filename + extname(req.file.originalname || ".pdf"));
  copyFileSync(req.file.path, dest);
  res.json({ path: dest });
});

app.get("/api/screenshots/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.screenshotPath || !existsSync(job.screenshotPath)) return res.status(404).end();
  res.sendFile(job.screenshotPath);
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const onEvent = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  bus.on("event", onEvent);
  req.on("close", () => bus.off("event", onEvent));
});

app.post("/api/browser/close", async (_req, res) => {
  await closeBrowser();
  res.json({ ok: true });
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const webDist = resolve(root, "apps/web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => res.sendFile(resolve(webDist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Job 9k API on http://localhost:${PORT}`);
});

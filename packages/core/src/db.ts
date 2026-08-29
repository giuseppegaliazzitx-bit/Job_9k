import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mergeChoices } from "./choices.js";
import type { AtsType, FieldConfidence, FieldMapRow, Job, JobEvent, JobStatus } from "./types.js";
import { getDataDir } from "./paths.js";

let db: DatabaseSync | null = null;

export function getDb(dataDir = getDataDir()): DatabaseSync {
  if (db) return db;
  const file = resolve(dataDir, "queue.db");
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      apply_url TEXT DEFAULT '',
      company TEXT DEFAULT '',
      title TEXT DEFAULT '',
      ats TEXT NOT NULL,
      ats_confidence REAL DEFAULT 0,
      fit_score INTEGER,
      status TEXT NOT NULL,
      note TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      jd_snippet TEXT DEFAULT '',
      resume_path TEXT DEFAULT '',
      cover_letter_path TEXT DEFAULT '',
      auto_submit INTEGER DEFAULT 0,
      screenshot_path TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS field_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT DEFAULT '',
      confidence TEXT NOT NULL,
      required INTEGER DEFAULT 0,
      choices TEXT DEFAULT '[]'
    );
  `);
  ensureColumn(d, "field_maps", "choices", "TEXT DEFAULT '[]'");
}

function ensureColumn(d: DatabaseSync, table: string, column: string, spec: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }
}

function now(): string {
  return new Date().toISOString();
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    url: String(row.url),
    applyUrl: String(row.apply_url ?? ""),
    company: String(row.company ?? ""),
    title: String(row.title ?? ""),
    ats: row.ats as AtsType,
    atsConfidence: Number(row.ats_confidence ?? 0),
    fitScore: row.fit_score == null ? null : Number(row.fit_score),
    status: row.status as JobStatus,
    note: String(row.note ?? ""),
    lastError: String(row.last_error ?? ""),
    jdSnippet: String(row.jd_snippet ?? ""),
    resumePath: String(row.resume_path ?? ""),
    coverLetterPath: String(row.cover_letter_path ?? ""),
    autoSubmit: Boolean(row.auto_submit),
    screenshotPath: String(row.screenshot_path ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function insertJob(input: {
  url: string;
  ats: AtsType;
  atsConfidence: number;
  company: string;
  title?: string;
}): Job {
  const d = getDb();
  const existing = d.prepare("SELECT * FROM jobs WHERE url = ?").get(input.url) as Record<string, unknown> | undefined;
  if (existing) return rowToJob(existing);
  const ts = now();
  const job: Job = {
    id: randomUUID(),
    url: input.url,
    applyUrl: input.url,
    company: input.company,
    title: input.title ?? "",
    ats: input.ats,
    atsConfidence: input.atsConfidence,
    fitScore: null,
    status: "queued",
    note: "",
    lastError: "",
    jdSnippet: "",
    resumePath: "",
    coverLetterPath: "",
    autoSubmit: false,
    screenshotPath: "",
    createdAt: ts,
    updatedAt: ts,
  };
  d.prepare(
    `INSERT INTO jobs (id, url, apply_url, company, title, ats, ats_confidence, fit_score, status, note, last_error, jd_snippet, resume_path, cover_letter_path, auto_submit, screenshot_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.url,
    job.applyUrl,
    job.company,
    job.title,
    job.ats,
    job.atsConfidence,
    job.fitScore,
    job.status,
    job.note,
    job.lastError,
    job.jdSnippet,
    job.resumePath,
    job.coverLetterPath,
    job.autoSubmit ? 1 : 0,
    job.screenshotPath,
    job.createdAt,
    job.updatedAt,
  );
  return job;
}

export function listJobs(status?: JobStatus | JobStatus[]): Job[] {
  const d = getDb();
  if (!status || (Array.isArray(status) && status.length === 0)) {
    return (d.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(rowToJob);
  }
  const statuses = Array.isArray(status) ? status : [status];
  const placeholders = statuses.map(() => "?").join(",");
  return (d.prepare(`SELECT * FROM jobs WHERE status IN (${placeholders}) ORDER BY created_at DESC`).all(...statuses) as Record<string, unknown>[]).map(rowToJob);
}

export function getJob(id: string): Job | null {
  const row = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function updateJob(id: string, patch: Partial<Job>): Job | null {
  const current = getJob(id);
  if (!current) return null;
  const next: Job = { ...current, ...patch, id: current.id, updatedAt: now() };
  getDb()
    .prepare(
      `UPDATE jobs SET url=?, apply_url=?, company=?, title=?, ats=?, ats_confidence=?,
       fit_score=?, status=?, note=?, last_error=?, jd_snippet=?, resume_path=?,
       cover_letter_path=?, auto_submit=?, screenshot_path=?, updated_at=?
       WHERE id=?`,
    )
    .run(
      next.url,
      next.applyUrl,
      next.company,
      next.title,
      next.ats,
      next.atsConfidence,
      next.fitScore,
      next.status,
      next.note,
      next.lastError,
      next.jdSnippet,
      next.resumePath,
      next.coverLetterPath,
      next.autoSubmit ? 1 : 0,
      next.screenshotPath,
      next.updatedAt,
      next.id,
    );
  return next;
}

export function deleteJob(id: string): boolean {
  const d = getDb();
  d.prepare("DELETE FROM events WHERE job_id = ?").run(id);
  d.prepare("DELETE FROM field_maps WHERE job_id = ?").run(id);
  const info = d.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  return Number(info.changes) > 0;
}

export function nextQueuedJob(): Job | null {
  const row = getDb()
    .prepare("SELECT * FROM jobs WHERE status IN ('queued','ready') ORDER BY created_at ASC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function addEvent(jobId: string, message: string, level: JobEvent["level"] = "info", payload: unknown = {}): void {
  getDb()
    .prepare("INSERT INTO events (job_id, ts, level, message, payload) VALUES (?, ?, ?, ?, ?)")
    .run(jobId, now(), level, message, JSON.stringify(payload ?? {}));
}

export function listEvents(jobId: string): JobEvent[] {
  const rows = getDb().prepare("SELECT * FROM events WHERE job_id = ? ORDER BY id ASC").all(jobId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    jobId: String(r.job_id),
    ts: String(r.ts),
    level: r.level as JobEvent["level"],
    message: String(r.message),
    payload: JSON.parse(String(r.payload || "{}")),
  }));
}

function parseChoices(raw: unknown): string[] {
  if (Array.isArray(raw)) return mergeChoices([], raw.map(String));
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? mergeChoices([], parsed.map(String)) : [];
  } catch {
    return [];
  }
}

export function replaceFieldMaps(jobId: string, rows: Array<Omit<FieldMapRow, "id" | "jobId">>): void {
  const d = getDb();
  d.prepare("DELETE FROM field_maps WHERE job_id = ?").run(jobId);
  const stmt = d.prepare(
    "INSERT INTO field_maps (job_id, label, value, confidence, required, choices) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows) {
    stmt.run(jobId, row.label, row.value, row.confidence, row.required ? 1 : 0, JSON.stringify(row.choices ?? []));
  }
}

export function listFieldMaps(jobId: string): FieldMapRow[] {
  const rows = getDb().prepare("SELECT * FROM field_maps WHERE job_id = ? ORDER BY id ASC").all(jobId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    jobId: String(r.job_id),
    label: String(r.label),
    value: String(r.value),
    confidence: r.confidence as FieldConfidence,
    required: Boolean(r.required),
    choices: parseChoices(r.choices),
  }));
}

export function listBlockedFieldMaps(): Array<{
  label: string;
  required: boolean;
  jobId: string;
  company: string;
  title: string;
  url: string;
  choices: string[];
}> {
  const rows = getDb()
    .prepare(
      `SELECT f.label, f.required, f.choices, j.id AS job_id, j.company, j.title, j.url
       FROM field_maps f
       JOIN jobs j ON j.id = f.job_id
       WHERE f.confidence = 'blocked'
       ORDER BY j.updated_at ASC, f.id ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    label: String(r.label),
    required: Boolean(r.required),
    jobId: String(r.job_id),
    company: String(r.company ?? ""),
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    choices: parseChoices(r.choices),
  }));
}

export function dbFileExists(dataDir = getDataDir()): boolean {
  return existsSync(resolve(dataDir, "queue.db"));
}

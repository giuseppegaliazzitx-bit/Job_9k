import { existsSync, readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";
import { mergeChoices } from "./choices.js";
import { listBlockedFieldMaps } from "./db.js";
import { cleanBlockedLabel } from "./labels.js";
import { fuzzyScore } from "./mapping.js";
import { getDataDir, resolveData } from "./paths.js";
import { loadAnswers, saveAnswers } from "./profile.js";
import type { AnswerBank } from "./types.js";

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

export interface QuestionInbox {
  items: InboxItem[];
}

export interface BlockedCapture {
  label: string;
  required?: boolean;
  company?: string;
  title?: string;
  url?: string;
  jobId?: string;
  choices?: string[];
}

export interface CaptureResult {
  addedKeys: string[];
  inboxAdded: string[];
  pendingCount: number;
}

const MATCH_THRESHOLD = 0.8;

export function scoreLabelToKey(label: string, key: string): number {
  return Math.max(fuzzyScore(label, key), fuzzyScore(label, key.replace(/_/g, " ")));
}

export function findMatchingAnswerKey(label: string, answers: AnswerBank, threshold = MATCH_THRESHOLD): string | null {
  let bestKey = "";
  let best = 0;
  for (const key of Object.keys(answers)) {
    const score = scoreLabelToKey(label, key);
    if (score > best) {
      best = score;
      bestKey = key;
    }
  }
  return bestKey && best >= threshold ? bestKey : null;
}

function findInboxItem(label: string, items: InboxItem[]): InboxItem | undefined {
  const exact = items.find((i) => i.key === label || i.label === label);
  if (exact) return exact;
  let best: InboxItem | undefined;
  let bestScore = 0;
  for (const item of items) {
    const score = Math.max(scoreLabelToKey(label, item.key), fuzzyScore(label, item.label));
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : undefined;
}

export function loadInbox(dataDir = getDataDir()): QuestionInbox {
  const path = resolveData(dataDir, "question-inbox.yml");
  if (!existsSync(path)) return { items: [] };
  const raw = yaml.load(readFileSync(path, "utf8")) as { items?: InboxItem[] } | InboxItem[] | null;
  const items = Array.isArray(raw) ? raw : (raw?.items ?? []);
  return {
    items: items.map((item) => ({
      key: String(item.key ?? ""),
      label: String(item.label ?? item.key ?? ""),
      required: Boolean(item.required),
      dismissed: Boolean(item.dismissed),
      seen: Number(item.seen ?? 1) || 1,
      firstSeen: String(item.firstSeen ?? ""),
      lastSeen: String(item.lastSeen ?? ""),
      lastCompany: String(item.lastCompany ?? ""),
      lastTitle: String(item.lastTitle ?? ""),
      lastUrl: String(item.lastUrl ?? ""),
      lastJobId: String(item.lastJobId ?? ""),
      sources: Array.isArray(item.sources) ? item.sources.map(String) : [],
      choices: mergeChoices([], Array.isArray(item.choices) ? item.choices.map(String) : []),
    })).filter((i) => i.key),
  };
}

export function saveInbox(inbox: QuestionInbox, dataDir = getDataDir()): void {
  const path = resolveData(dataDir, "question-inbox.yml");
  writeFileSync(path, yaml.dump({ items: inbox.items }, { lineWidth: 120 }), "utf8");
}

function sourceKey(field: BlockedCapture, label: string): string {
  return `${field.jobId || field.url || "unknown"}::${label}`;
}

export function captureBlockedFields(fields: BlockedCapture[], dataDir = getDataDir()): CaptureResult {
  const answers = loadAnswers(dataDir);
  const inbox = loadInbox(dataDir);
  const addedKeys: string[] = [];
  const inboxAdded: string[] = [];
  const now = new Date().toISOString();
  let answersChanged = false;
  let inboxChanged = false;

  for (const field of fields) {
    const label = cleanBlockedLabel(field.label);
    if (!label) continue;

    const existingInbox = findInboxItem(label, inbox.items);
    if (existingInbox?.dismissed) continue;

    const matchedKey = findMatchingAnswerKey(label, answers);
    const key = existingInbox?.key || matchedKey || label;
    if ((answers[key] ?? "").trim()) continue;

    const src = sourceKey(field, label);
    const isRequired = Boolean(field.required) || /\*/.test(String(field.label));
    if (!(key in answers)) {
      answers[key] = "";
      addedKeys.push(key);
      answersChanged = true;
    }

    const item = existingInbox ?? {
      key,
      label,
      required: isRequired,
      dismissed: false,
      seen: 0,
      firstSeen: now,
      lastSeen: now,
      lastCompany: "",
      lastTitle: "",
      lastUrl: "",
      lastJobId: "",
      sources: [],
      choices: [],
    };

    if (!existingInbox) {
      inbox.items.push(item);
      inboxAdded.push(key);
      inboxChanged = true;
    }

    if (isRequired && !item.required) {
      item.required = true;
      inboxChanged = true;
    }

    const nextChoices = mergeChoices(item.choices, field.choices);
    if (nextChoices.length > item.choices.length) {
      item.choices = nextChoices;
      inboxChanged = true;
    }

    if (!item.sources.includes(src)) {
      item.sources.push(src);
      item.seen += 1;
      item.lastSeen = now;
      item.lastCompany = field.company || item.lastCompany;
      item.lastTitle = field.title || item.lastTitle;
      item.lastUrl = field.url || item.lastUrl;
      item.lastJobId = field.jobId || item.lastJobId;
      if (label.length > item.label.length) item.label = label;
      inboxChanged = true;
    }
  }

  if (answersChanged) saveAnswers(answers, dataDir);
  if (inboxChanged) saveInbox(inbox, dataDir);

  return { addedKeys, inboxAdded, pendingCount: listPendingInbox(dataDir).length };
}

export function listPendingInbox(dataDir = getDataDir()): InboxItem[] {
  const answers = loadAnswers(dataDir);
  return loadInbox(dataDir)
    .items.filter((item) => !item.dismissed && !(answers[item.key] ?? "").trim())
    .sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label));
}

export function answerInboxItems(values: Record<string, string>, dataDir = getDataDir()): InboxItem[] {
  const answers = loadAnswers(dataDir);
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    const v = String(value ?? "").trim();
    if (!key || !v) continue;
    answers[key] = v;
    changed = true;
  }
  if (changed) saveAnswers(answers, dataDir);
  return listPendingInbox(dataDir);
}

export function dismissInboxItems(keys: string[], dataDir = getDataDir()): InboxItem[] {
  const inbox = loadInbox(dataDir);
  const set = new Set(keys.filter(Boolean));
  for (const item of inbox.items) {
    if (set.has(item.key)) item.dismissed = true;
  }
  saveInbox(inbox, dataDir);
  return listPendingInbox(dataDir);
}

export function harvestBlockedFromDb(dataDir = getDataDir()): CaptureResult {
  return captureBlockedFields(listBlockedFieldMaps(), dataDir);
}

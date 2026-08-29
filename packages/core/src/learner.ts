import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getDataDir, resolveData } from "./paths.js";
import { cleanBlockedLabel } from "./labels.js";

export interface OptionMapping {
  ats: string;
  label: string;
  from: string;
  to: string;
  count: number;
  lastSeen: string;
}

export interface Learnings {
  version: 1;
  option_mappings: OptionMapping[];
}

function emptyLearnings(): Learnings {
  return { version: 1, option_mappings: [] };
}

function normLabel(label: string): string {
  return (cleanBlockedLabel(label) || label).replace(/\s+/g, " ").trim().toLowerCase();
}

export function loadLearnings(dataDir = getDataDir()): Learnings {
  const path = resolveData(dataDir, "learnings.json");
  if (!existsSync(path)) return emptyLearnings();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Learnings>;
    return {
      version: 1,
      option_mappings: Array.isArray(raw.option_mappings)
        ? raw.option_mappings.map((m) => ({
            ats: String(m.ats ?? ""),
            label: String(m.label ?? ""),
            from: String(m.from ?? ""),
            to: String(m.to ?? ""),
            count: Number(m.count ?? 1) || 1,
            lastSeen: String(m.lastSeen ?? ""),
          }))
        : [],
    };
  } catch {
    return emptyLearnings();
  }
}

export function saveLearnings(data: Learnings, dataDir = getDataDir()): void {
  const path = resolveData(dataDir, "learnings.json");
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export function recordOptionCorrection(
  input: { ats?: string; label: string; from: string; to: string },
  dataDir = getDataDir(),
): void {
  const from = input.from.trim();
  const to = input.to.trim();
  const label = normLabel(input.label);
  if (!from || !to || from.toLowerCase() === to.toLowerCase() || !label) return;
  const data = loadLearnings(dataDir);
  const ats = input.ats ?? "";
  const existing = data.option_mappings.find(
    (m) => m.label === label && m.from.toLowerCase() === from.toLowerCase() && (!ats || m.ats === ats || !m.ats),
  );
  if (existing) {
    existing.to = to;
    existing.ats = ats || existing.ats;
    existing.count += 1;
    existing.lastSeen = new Date().toISOString();
  } else {
    data.option_mappings.push({
      ats,
      label,
      from,
      to,
      count: 1,
      lastSeen: new Date().toISOString(),
    });
  }
  saveLearnings(data, dataDir);
}

export function applyOptionLearning(label: string, value: string, ats = "", dataDir = getDataDir()): string {
  const v = value.trim();
  if (!v) return v;
  const key = normLabel(label);
  const data = loadLearnings(dataDir);
  const matches = data.option_mappings.filter(
    (m) => m.label === key && m.from.toLowerCase() === v.toLowerCase(),
  );
  const prefer = ats ? matches.find((m) => m.ats === ats) : undefined;
  return (prefer ?? matches[0])?.to ?? v;
}

export function rememberSnappedValue(label: string, planned: string, snapped: string, ats = "", dataDir = getDataDir()): string {
  const next = applyOptionLearning(label, planned, ats, dataDir);
  const final = snapped.trim() || next;
  if (planned.trim() && final && planned.trim().toLowerCase() !== final.toLowerCase()) {
    recordOptionCorrection({ ats, label, from: planned, to: final }, dataDir);
  }
  return final;
}

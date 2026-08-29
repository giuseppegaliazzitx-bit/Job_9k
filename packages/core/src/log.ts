import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AtsType, FieldMapRow, JobStatus } from "./types.js";
import { getDataDir } from "./paths.js";

export interface ApplicationLog {
  url: string;
  ats: AtsType;
  timestamp: string;
  status: JobStatus;
  fields_filled: string[];
  fields_blocked: string[];
  screenshot_path: string;
  company?: string;
  title?: string;
  note?: string;
}

export function appendApplicationLog(entry: ApplicationLog, dataDir = getDataDir()): void {
  const line = JSON.stringify(entry) + "\n";
  appendFileSync(resolve(dataDir, "applications.jsonl"), line, "utf8");
}

export function logFromMaps(
  url: string,
  ats: AtsType,
  status: JobStatus,
  maps: FieldMapRow[],
  screenshotPath: string,
  extra?: { company?: string; title?: string; note?: string },
): void {
  appendApplicationLog({
    url,
    ats,
    timestamp: new Date().toISOString(),
    status,
    fields_filled: maps.filter((m) => m.confidence === "filled").map((m) => m.label),
    fields_blocked: maps.filter((m) => m.confidence === "blocked").map((m) => m.label),
    screenshot_path: screenshotPath,
    ...extra,
  });
}

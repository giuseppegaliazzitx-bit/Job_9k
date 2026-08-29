import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function getRepoRoot(): string {
  return repoRoot;
}

export function getDataDir(override?: string): string {
  const raw = override || process.env.JOB9K_DATA_DIR || "./data";
  const dir = isAbsolute(raw) ? raw : resolve(repoRoot, raw);
  mkdirSync(dir, { recursive: true });
  mkdirSync(resolve(dir, "resumes"), { recursive: true });
  mkdirSync(resolve(dir, "screenshots"), { recursive: true });
  mkdirSync(resolve(dir, "cover-letters"), { recursive: true });
  mkdirSync(resolve(dir, "browser-profile"), { recursive: true });
  return dir;
}

export function resolveData(dataDir: string, ...parts: string[]): string {
  return resolve(dataDir, ...parts);
}

export function resolveMaybeRelative(p: string, dataDir: string): string {
  if (!p) return "";
  if (isAbsolute(p)) return p;
  return resolve(getRepoRoot(), p);
}

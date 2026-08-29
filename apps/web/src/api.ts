import type { FieldMap, Job, JobEvent } from "./types";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  jobs: (status?: string) => j<Job[]>(`/api/jobs${status ? `?status=${status}` : ""}`),
  addJobs: (text: string) => j<{ jobs: Job[] }>("/api/jobs", { method: "POST", body: JSON.stringify({ text }) }),
  job: (id: string) => j<{ job: Job; events: JobEvent[]; fields: FieldMap[]; run: { paused: boolean; pendingQuestion?: string } | null }>(`/api/jobs/${id}`),
  patchJob: (id: string, body: Partial<Job>) => j<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteJob: (id: string) => j(`/api/jobs/${id}`, { method: "DELETE" }),
  skip: (id: string) => j(`/api/jobs/${id}/skip`, { method: "POST", body: "{}" }),
  fill: (id: string, autoSubmit = false) => j(`/api/jobs/${id}/fill`, { method: "POST", body: JSON.stringify({ autoSubmit }) }),
  runNext: () => j<{ jobId: string }>("/api/jobs/run-next", { method: "POST", body: "{}" }),
  runSelected: (ids: string[], autoSubmit = false) =>
    j("/api/jobs/run-selected", { method: "POST", body: JSON.stringify({ ids, autoSubmit }) }),
  pause: (id: string, paused = true) => j(`/api/jobs/${id}/pause`, { method: "POST", body: JSON.stringify({ paused }) }),
  takeover: (id: string) => j(`/api/jobs/${id}/takeover`, { method: "POST", body: "{}" }),
  resolve: (id: string, action: string, value?: string) =>
    j(`/api/jobs/${id}/resolve`, { method: "POST", body: JSON.stringify({ action, value }) }),
  profile: () => j<Record<string, unknown>>("/api/profile"),
  saveProfile: (p: unknown) => j("/api/profile", { method: "PUT", body: JSON.stringify(p) }),
  answers: () => j<Record<string, string>>("/api/answers"),
  saveAnswers: (a: Record<string, string>) => j("/api/answers", { method: "PUT", body: JSON.stringify(a) }),
  settings: () => j<Record<string, unknown>>("/api/settings"),
  saveSettings: (s: unknown) => j("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
};

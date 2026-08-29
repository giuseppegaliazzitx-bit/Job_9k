import { EventEmitter } from "node:events";

export type BusEvent =
  | { type: "status"; jobId: string; status: string }
  | { type: "log"; jobId: string; message: string; level: "info" | "warn" | "error" }
  | { type: "field"; jobId: string; label: string; value: string; confidence: string }
  | { type: "screenshot"; jobId: string; path: string }
  | { type: "question"; jobId: string; runId: string; question: string; draft: string }
  | { type: "done"; jobId: string; status: string }
  | { type: "inbox"; jobId: string; added: number; pending: number };

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emit(event: BusEvent): void {
  bus.emit("event", event);
  if ("jobId" in event) bus.emit(`job:${event.jobId}`, event);
}

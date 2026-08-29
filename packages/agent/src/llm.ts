import OpenAI from "openai";
import type { Profile, Settings } from "@job9k/core";

export function llmEnabled(settings: Settings): boolean {
  return settings.llm.provider !== "none";
}

function clientFor(settings: Settings): OpenAI | null {
  if (settings.llm.provider === "none") return null;
  const key = process.env[settings.llm.api_key_env] || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (settings.llm.provider === "anthropic") {
    return new OpenAI({
      apiKey: key,
      baseURL: settings.llm.base_url || "https://api.anthropic.com/v1",
    });
  }
  return new OpenAI({
    apiKey: key,
    baseURL: settings.llm.base_url || "https://api.x.ai/v1",
  });
}

export async function chatJson(settings: Settings, system: string, user: string): Promise<string | null> {
  const client = clientFor(settings);
  if (!client) return null;
  try {
    const resp = await client.chat.completions.create({
      model: settings.llm.model || "grok-4.6",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return resp.choices[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export async function summarizeJd(settings: Settings, jd: string, profile: Profile): Promise<{ snippet: string; fit: number | null }> {
  const snippet = jd.slice(0, 600);
  if (!llmEnabled(settings)) return { snippet, fit: null };
  const raw = await chatJson(
    settings,
    "Score job fit 1-5 from the candidate profile. Never invent work history. Return JSON {fit: number, summary: string}.",
    `PROFILE SKILLS: ${profile.skills.join(", ")}\nTITLE: ${profile.experience.current_title}\nJD:\n${jd.slice(0, 6000)}`,
  );
  if (!raw) return { snippet, fit: null };
  try {
    const json = JSON.parse(raw.replace(/```json|```/g, "").trim()) as { fit?: number; summary?: string };
    const fit = typeof json.fit === "number" ? Math.max(1, Math.min(5, Math.round(json.fit))) : null;
    return { snippet: json.summary?.slice(0, 600) || snippet, fit };
  } catch {
    return { snippet, fit: null };
  }
}

export async function draftUnknownAnswer(
  settings: Settings,
  question: string,
  profile: Profile,
  answers: Record<string, string>,
): Promise<string> {
  if (!llmEnabled(settings)) return "";
  const raw = await chatJson(
    settings,
    "Draft a short application answer from the given profile and answer bank. Never invent employers, dates, or titles. If the question is work authorization, sponsorship, years of experience, salary, or clearance and the answer is missing, return empty string. Return the answer text only.",
    `QUESTION: ${question}\nPROFILE: ${JSON.stringify({ identity: profile.identity, experience: profile.experience, education: profile.education })}\nANSWERS: ${JSON.stringify(answers)}`,
  );
  return (raw ?? "").trim();
}

export interface AgentFillPlan {
  fills: Array<{ label: string; value: string }>;
  blocked: Array<{ label: string; reason: string }>;
}

export async function planUnknownForm(
  settings: Settings,
  fields: Array<{ label: string; type: string }>,
  profile: Profile,
  answers: Record<string, string>,
): Promise<AgentFillPlan | null> {
  if (!llmEnabled(settings)) return null;
  const raw = await chatJson(
    settings,
    `Map form fields to profile values. Never invent work history. Never guess knockout questions (work auth, sponsorship, years of experience, salary, clearance) unless present in profile or answers. Return JSON {"fills":[{"label":"","value":""}],"blocked":[{"label":"","reason":""}]}`,
    JSON.stringify({ fields, profile: { identity: profile.identity, experience: profile.experience, education: profile.education, eeo: profile.eeo, work_auth: profile.work_auth }, answers }),
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as AgentFillPlan;
  } catch {
    return null;
  }
}

const PLACEHOLDER =
  /^(select(\s*\.{0,3})?|please select|choose(\s+one)?|pick one|n\/?a|--|—|–|none|no options)$/i;

export function normalizeChoice(text: string): string | null {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 220 || PLACEHOLDER.test(t)) return null;
  return t;
}

export function mergeChoices(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(existing ?? []), ...(incoming ?? [])]) {
    const t = normalizeChoice(raw);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 250) break;
  }
  return out;
}

export function pickClosestChoice(value: string, choices: string[] | undefined): string {
  const v = value.trim();
  if (!v || !choices?.length) return v;
  const exact = choices.find((c) => c.toLowerCase() === v.toLowerCase());
  if (exact) return exact;
  let best = v;
  let bestScore = 0;
  for (const c of choices) {
    const score = choiceScore(v, c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.3 ? best : v;
}

function choiceScore(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.includes(x) || x.includes(y)) return 0.8;
  const aw = x.split(/[\s_\-/]+/).filter(Boolean);
  const bw = y.split(/[\s_\-/]+/).filter(Boolean);
  if (!aw.length || !bw.length) return 0;
  const overlap = aw.filter((w) => bw.some((v) => v.includes(w) || w.includes(v)));
  return (overlap.length / Math.max(aw.length, bw.length)) * 0.6;
}

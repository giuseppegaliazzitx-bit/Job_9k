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

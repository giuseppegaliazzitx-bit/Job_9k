const JUNK =
  /^(field|input|select|textarea|checkbox|radio|file|submit|button|hidden|search|honeypot|recaptcha|resume|cv|cover[\s_-]*letter)$/i;

export function collapseRepeatedPhrase(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return s;
  for (let n = 1; n <= Math.floor(words.length / 2); n++) {
    if (words.length % n !== 0) continue;
    const unit = words.slice(0, n).join(" ");
    let ok = true;
    for (let i = n; i < words.length; i += n) {
      if (unit.toLowerCase() !== words.slice(i, i + n).join(" ").toLowerCase()) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let i = 0; i < words.length; i += n) {
      const cand = words.slice(i, i + n).join(" ");
      if (/[A-Z]/.test(cand)) return cand;
    }
    return unit;
  }
  return s;
}

export function cleanBlockedLabel(raw: string): string | null {
  let s = String(raw ?? "")
    .replace(/\*+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  s = s.replace(/^question_\d+\s+/i, "");
  s = s.replace(/^[a-z][\w-]*--\d+\s+/i, "");
  s = collapseRepeatedPhrase(s);
  s = s.replace(/^[a-z][\w-]*\s+(?=[A-Z("])/u, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[.\s]+$/g, "").trim();
  if (!s || s.length < 2 || JUNK.test(s)) return null;
  return s;
}

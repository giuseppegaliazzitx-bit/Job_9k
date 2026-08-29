const OTP_PATTERNS = [
  /verification\s*code\s*(?:is)?[:\s]+([A-Za-z0-9]*\d[A-Za-z0-9]{3,9})/i,
  /enter\s*(?:this\s*)?code[:\s]+([A-Za-z0-9]*\d[A-Za-z0-9]{3,9})/i,
  /\bOTP\s*(?:is)?[:\s]+([A-Za-z0-9]*\d[A-Za-z0-9]{3,9})/i,
  /one[\s-]?time\s*(?:pass)?code[:\s]+([A-Za-z0-9]*\d[A-Za-z0-9]{3,9})/i,
  /\bcode[:\s]+([A-Za-z0-9]*\d[A-Za-z0-9]{3,9})\b/i,
  /^\s*(\d{6,8})\s*$/m,
  /\b(\d{6})\b/,
];

const OTP_PROMPT =
  /verification\s*code|enter\s*(the\s*)?code|confirm\s*you.*human|\d[\s-]character\s*code|code\s*was\s*sent|sent.*code|check your email|we (emailed|sent) you/i;

export function extractOTP(text: string): string | null {
  const body = String(text ?? "");
  for (const pattern of OTP_PATTERNS) {
    const match = body.match(pattern);
    if (match?.[1] && !isLikelyFalsePositive(match[1], body)) return match[1];
  }
  return null;
}

function isLikelyFalsePositive(code: string, body: string): boolean {
  if (!/\d/.test(code)) return true;
  if (/expires|minutes|verify|email|please/i.test(code)) return true;
  if (/^\d{8}$/.test(code) && /20\d{2}/.test(code)) return true;
  if (/^\d{6}$/.test(code) && /zip|postal|phone|ext\b/i.test(body) && !/verif|otp|code/i.test(body)) return true;
  return false;
}

export function looksLikeOtpPrompt(text: string): boolean {
  return OTP_PROMPT.test(String(text ?? ""));
}

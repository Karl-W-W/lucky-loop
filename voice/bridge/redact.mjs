// Text that reaches the voice agent (and so a hosted LLM and Karl's ear) passes through here.
// The shapes mirror VALUE_SHAPES in ~/brain/tools/needs-you-write: a value is never spoken.
const SHAPES = [
  ["phone number", /\+\d[\d ()/-]{7,18}\d/g],
  ["IBAN", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/g],
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ["bearer token", /Bearer\s+[A-Za-z0-9._-]{12,}/g],
  ["api key", /\b(?:sk|pk|rk|xi)[-_][A-Za-z0-9_-]{16,}/g],
  ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ["slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/g],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["aws key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["long hex", /\b[a-f0-9]{40,}\b/g],
];

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

export function redact(text) {
  let out = String(text ?? "").replace(ANSI, "");
  for (const [name, re] of SHAPES) out = out.replace(re, `[${name} withheld]`);
  return out;
}

export function clip(text, max = 1500) {
  const s = String(text ?? "");
  return s.length <= max ? s : s.slice(0, max) + " …[clipped]";
}

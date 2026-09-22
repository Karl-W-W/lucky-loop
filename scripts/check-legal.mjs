/**
 * check-legal — the legal gate (2026-09-22).
 *
 * The Stripe-minimum pages (pricing card, Impressum, Datenschutz, AGB, Kontakt)
 * render CONTENT that Karl types: data/impressum.json, data/pricing.json and
 * content/legal/*.md. A placeholder, an empty field or a draft marker in any of
 * them is a legal page that lies — so this gate refuses the build (npm prebuild)
 * and the CI gates job. It checks shape and consistency only; whether a sentence
 * is TRUE is a human's job and is not claimed here.
 *   node scripts/check-legal.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["impressum", "datenschutz", "agb", "kontakt"];
const FORBIDDEN = ["{{", "}}", "[[", "]]", "TODO", "TBD", "FIXME", "XXX", "Muster", "Lorem", "PLACEHOLDER", "coming soon"];
const has = (s, t) => s.toLowerCase().includes(t.toLowerCase());
const problems = [];

function read(p) {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) { problems.push(`${p}: missing`); return ""; }
  const s = readFileSync(abs, "utf8");
  if (!s.trim()) problems.push(`${p}: empty`);
  return s;
}
function nonEmpty(obj, key, file) {
  const v = obj[key];
  if (typeof v !== "string" || !v.trim()) problems.push(`${file}: "${key}" is empty`);
  else if (FORBIDDEN.some((t) => has(v, t))) problems.push(`${file}: "${key}" holds a placeholder`);
}

const impressum = JSON.parse(read("data/impressum.json") || "{}");
for (const k of ["name", "street", "city", "country", "email", "responsible"]) nonEmpty(impressum, k, "data/impressum.json");
if (impressum.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(impressum.email)) problems.push("data/impressum.json: email is not an address");

const pricing = JSON.parse(read("data/pricing.json") || "{}");
if (pricing.currency !== "EUR") problems.push("data/pricing.json: currency must be EUR");
if (pricing.audience !== "business") problems.push("data/pricing.json: audience must be \"business\" (B2B only, Karl 2026-09-22)");
if (!Number.isInteger(pricing.hosted?.monthlyEur) || pricing.hosted.monthlyEur <= 0) problems.push("data/pricing.json: hosted.monthlyEur must be a positive integer");
if (!Number.isInteger(pricing.setup?.fromEur) || pricing.setup.fromEur <= 0) problems.push("data/pricing.json: setup.fromEur must be a positive integer");
if (!Array.isArray(pricing.methods) || pricing.methods.length === 0) problems.push("data/pricing.json: methods is empty");
if (typeof pricing.paymentLink !== "string" || (pricing.paymentLink && !/^https:\/\/(buy|checkout)\.stripe\.com\//.test(pricing.paymentLink)))
  problems.push("data/pricing.json: paymentLink must be empty or a https://buy.stripe.com/… or https://checkout.stripe.com/… URL");

const texts = {};
for (const page of PAGES) {
  const p = `content/legal/${page}.md`;
  const s = read(p); texts[page] = s;
  if (!s) continue;
  for (const t of FORBIDDEN) if (has(s, t)) problems.push(`${p}: contains "${t}"`);
  if (!/^# /m.test(s)) problems.push(`${p}: no "# " title`);
  if (!/^Stand: \d{1,2}\. \w+ \d{4}\s*$/m.test(s)) problems.push(`${p}: no closing "Stand: <date>" line`);
  if (/^\|/m.test(s) || /<[a-z]+[ >]/i.test(s)) problems.push(`${p}: tables or HTML are not rendered — plain markdown only`);
}
// Impressum block must match the JSON, character for character.
if (texts.impressum) for (const k of ["name", "street", "city", "email"]) {
  if (impressum[k] && !texts.impressum.includes(impressum[k])) problems.push(`content/legal/impressum.md: does not carry data/impressum.json "${k}" (${impressum[k]})`);
}
// The AGB must carry the same amounts the price card shows.
if (texts.agb) {
  const m = String(pricing.hosted?.monthlyEur ?? ""), s = String(pricing.setup?.fromEur ?? "");
  const sDot = s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (m && !texts.agb.includes(m)) problems.push(`content/legal/agb.md: does not state the monthly price ${m}`);
  if (s && !texts.agb.includes(s) && !texts.agb.includes(sDot)) problems.push(`content/legal/agb.md: does not state the setup price ${sDot}`);
  if (!/§\s*14\s*BGB/.test(texts.agb)) problems.push("content/legal/agb.md: must state the B2B scope (§ 14 BGB)");
  if (/Widerrufsbelehrung|Widerrufsformular|312k/.test(texts.agb)) problems.push("content/legal/agb.md: consumer clauses (Widerruf, § 312k) do not belong in a B2B-only AGB");
}

// The maturity sentence in the AGB and on the Kontakt page restates numbers
// that /war and / DERIVE at build (data/okrs.json O3/KR1.derived, from
// data/loop-runs.json). Hand-typed prose drifts; this check fails the build
// when the legal pages no longer carry the derived pass count or miss one of
// the derived document types — the same rule as the price mismatch above.
const DOC_WORDS = {
  invoice: /Rechnung|invoice/i, "vat-invoice": /Umsatzsteuerrechnung|VAT invoice/i, receipt: /Beleg|receipt/i,
  other: /sonstig|other document/i, reminder: /Mahnung|reminder/i, statement: /Kontoauszug|statement/i, notice: /Bescheid|notice/i,
};
const NUM_WORDS = { 1: "ein|one", 2: "zwei|two", 3: "drei|three", 4: "vier|four", 5: "fünf|five", 6: "sechs|six", 7: "sieben|seven", 8: "acht|eight", 9: "neun|nine", 10: "zehn|ten" };
try {
  const okrs = JSON.parse(read("data/okrs.json") || "{}");
  const kr1 = (okrs.objectives || []).find((o) => o.id === "O3")?.keyResults?.find((k) => k.id === "KR1");
  const d = kr1 && kr1.derived;
  if (d && Number.isInteger(d.passes)) {
    const total = d.passes + (d.fixturesExcluded || 0);
    const totalRe = new RegExp(`\\b(${total}|${NUM_WORDS[total] || total})\\b`, "i");
    for (const page of ["agb", "kontakt"]) {
      const s = texts[page]; if (!s) continue;
      if (!totalRe.test(s)) problems.push(`content/legal/${page}.md: does not carry the derived pass count (${total}) — data/okrs.json O3/KR1.derived moved; update the maturity sentence`);
      for (const t of d.docTypes || []) {
        const re = DOC_WORDS[t];
        if (re && !re.test(s)) problems.push(`content/legal/${page}.md: derived document type "${t}" is not named in the maturity sentence`);
      }
    }
  }
} catch (e) { problems.push(`data/okrs.json: unreadable for the maturity check (${e.message})`); }

if (problems.length) {
  console.error(`check-legal: REFUSING — ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-legal: ok — impressum ${impressum.name} · hosted €${pricing.hosted.monthlyEur}/month · setup from €${pricing.setup.fromEur} · ${PAGES.length} legal pages · paymentLink ${pricing.paymentLink ? "set" : "empty (mailto)"}`);

#!/usr/bin/env node
/* Build-time OKR derivation for /war (npm `prebuild`, right after gen-ledger).
 *
 * Two key results in data/okrs.json used to be hand-typed and drifted from the
 * data they described (O3/KR4 said 0.14 "snapshot of 2026-09-10"; O3/KR1 said
 * "3 passes on 2 real documents" while four real passes existed). This script
 * derives both from data/loop-runs.json — the COMMITTED snapshot, because /war
 * is build-time data — and stamps each derived KR with where the number came
 * from. Every other KR keeps `derived: false` (declared).
 *
 *   O3/KR4  consecutive unattended converged nights, min(1, streak / 7).
 *           The definition is the Today page's, ported line for line from
 *           hermes/plugins/fleet/dashboard/today_api.py::_converged_nights
 *           (Karl, 2026-09-10) and unit-tested against it
 *           (scripts/gen-okr-derived.test.mjs). Do not invent a second one:
 *             night N = 20:00Z on date N -> 08:00Z on date N+1; night 1 = 2026-09-08
 *             no pass finished in the window      -> IDLE (neither counts nor resets)
 *             every pass in it ended "converged"   -> streak + 1
 *             any other termination                -> streak resets to 0
 *           counted over every COMPLETED night (window end <= now).
 *   O3/KR1  real documents processed, min(1, realPasses / 10). A real pass is
 *           one whose item is not the fixture: loop/fixtures/synthetic-bill.txt
 *           is recognised by its idempotency key, sha256(text + graphVersion +
 *           model)[:16] exactly as loop/run.py computes it, with the fixture's
 *           byte count and line count as the fallback signature.
 *
 * Day-after rule (CLAUDE.md): the empty state and the after-boundary state
 * are defined, not clamped. No passes -> 0 with the note "no passes yet"; a
 * reset names the night that reset the streak; a page that renders a derived
 * value renders the snapshot's generatedAt beside it, because the Today page
 * derives from the box's LIVE file and the two can legitimately differ.
 *
 *   node scripts/gen-okr-derived.mjs            write data/okrs.json
 *   node scripts/gen-okr-derived.mjs --check    exit 1 if the committed values
 *                                               differ from a recomputation
 *   OKR_NOW=<iso>                               fix "now" (tests)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RUNS_PATH = join(ROOT, "data", "loop-runs.json");
export const OKRS_PATH = join(ROOT, "data", "okrs.json");
export const FIXTURE_PATH = join(ROOT, "loop", "fixtures", "synthetic-bill.txt");
const SELF = "scripts/gen-okr-derived.mjs";
const FROM = "data/loop-runs.json";

export const NIGHT_START = "2026-09-08";
export const NIGHT_START_HOUR_UTC = 20;
export const NIGHT_HOURS = 12;
export const TARGET_NIGHTS = 7;
export const TARGET_DOCS = 10;

/* today_api._parse_dt: trim, "Z" -> +00:00, naive -> UTC, anything else -> null. */
export function parseDt(s) {
  if (!s || typeof s !== "string") return null;
  let t = s.trim();
  if (!t) return null;
  if (t.endsWith("Z")) t = t.slice(0, -1) + "+00:00";
  if (!/[+-]\d\d:?\d\d$/.test(t)) t += "+00:00";
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

const isoDay = (d) => d.toISOString().slice(0, 10);

/* Port of today_api._converged_nights(start). `now` is a Date. */
export function convergedNights(runs, now, start = NIGHT_START) {
  const day0 = parseDt(`${start}T${String(NIGHT_START_HOUR_UTC).padStart(2, "0")}:00:00+00:00`);
  let streak = 0, idle = 0, nights = 0, lastCounted = null, lastReset = null;
  for (let n = 0; ; n++) {
    const w0 = new Date(day0.getTime() + n * 86_400_000);
    const w1 = new Date(w0.getTime() + NIGHT_HOURS * 3_600_000);
    if (w1 > now) break;
    nights += 1;
    const inside = runs.filter((r) => {
      const t = parseDt(r.finishedAt);
      return t && t >= w0 && t < w1;
    });
    if (inside.length === 0) {
      idle += 1;
    } else if (inside.every((r) => r.terminationReason === "converged")) {
      streak += 1;
      lastCounted = isoDay(w0);
    } else {
      streak = 0;
      lastCounted = isoDay(w0);
      lastReset = isoDay(w0);
    }
  }
  return { streak, idle, nights, lastCounted, lastReset };
}

/* loop/run.py: key = sha256(raw + GRAPH_VERSION + model)[:16]. */
export function idempotencyKey(text, graphVersion, model) {
  return createHash("sha256").update(text + graphVersion + model, "utf8").digest("hex").slice(0, 16);
}

export function fixtureSignature(text) {
  return { chars: text.length, lines: text.split("\n").length - 1 };
}

export function isFixtureRun(run, fixtureText) {
  if (!fixtureText) return false;
  const gv = run.graphVersion ?? "";
  const model = run.model ?? "";
  if (run.idempotencyKey && run.idempotencyKey === idempotencyKey(fixtureText, gv, model)) return true;
  const sig = fixtureSignature(fixtureText);
  const item = run.item ?? {};
  return item.chars === sig.chars && item.lines === sig.lines;
}

export function realDocuments(runs, fixtureText) {
  const real = runs.filter((r) => !isFixtureRun(r, fixtureText));
  const docTypes = [...new Set(real.map((r) => r.item?.docType).filter(Boolean))].sort();
  return { passes: real.length, fixturesExcluded: runs.length - real.length, docTypes };
}

const r2 = (x) => Math.round(x * 100) / 100;

export function derive({ runs, generatedAt, fixtureText, now }) {
  const computedAt = now.toISOString();
  const snap = generatedAt ? ` · snapshot ${generatedAt}` : "";
  const nights = convergedNights(runs, now);
  const kr4Note = runs.length === 0
    ? `no passes yet${snap}`
    : `${nights.streak}/${TARGET_NIGHTS} consecutive converged nights since ${NIGHT_START}→09` +
      ` · ${nights.idle} of ${nights.nights} night(s) idle (skipped)` +
      (nights.lastCounted ? ` · last counted ${nights.lastCounted}` : "") +
      (nights.lastReset ? ` · streak reset by night ${nights.lastReset}` : "") + snap;
  const docs = realDocuments(runs, fixtureText);
  const kr1Note = docs.passes === 0
    ? `no passes yet${snap}`
    : `${docs.passes}/${TARGET_DOCS} real-document passes · ${docs.docTypes.length} doc type(s)` +
      (docs.docTypes.length ? ` (${docs.docTypes.join(", ")})` : "") +
      ` · ${docs.fixturesExcluded} fixture pass(es) excluded` + snap;
  return {
    "O3/KR4": {
      progress: r2(Math.min(1, nights.streak / TARGET_NIGHTS)),
      note: `derived at build time by ${SELF} from ${FROM} with the Today page's definition ` +
            "(today_api.py::_converged_nights: a night is 20:00Z→08:00Z; every pass converged = +1; " +
            "any other end = reset; no pass = skipped). The numbers live in `derived`, never here.",
      derived: { by: SELF, from: FROM, computedAt, streak: nights.streak, idle: nights.idle,
                 nights: nights.nights, lastCounted: nights.lastCounted, lastReset: nights.lastReset,
                 snapshotGeneratedAt: generatedAt ?? null, note: kr4Note },
    },
    "O3/KR1": {
      progress: r2(Math.min(1, docs.passes / TARGET_DOCS)),
      note: `derived at build time by ${SELF} from ${FROM}: passes whose item is not ` +
            "loop/fixtures/synthetic-bill.txt (matched by loop/run.py's idempotency key), " +
            "min(1, passes / 10). The numbers live in `derived`, never here.",
      derived: { by: SELF, from: FROM, computedAt, passes: docs.passes,
                 fixturesExcluded: docs.fixturesExcluded, docTypes: docs.docTypes,
                 snapshotGeneratedAt: generatedAt ?? null, note: kr1Note },
    },
  };
}

/* Apply to the okrs document: derived KRs get progress + derived; every other
 * KR gets derived:false. Key order is preserved (derived goes last). */
export function applyDerived(okrs, values) {
  for (const o of okrs.objectives ?? []) {
    for (const kr of o.keyResults ?? []) {
      const key = `${o.id}/${kr.id}`;
      const v = values[key];
      const rest = Object.fromEntries(Object.entries(kr).filter(([k]) => k !== "derived"));
      const next = v ? { ...rest, progress: v.progress, note: v.note, derived: v.derived } : { ...rest, derived: false };
      for (const k of Object.keys(kr)) delete kr[k];
      Object.assign(kr, next);
    }
  }
  return okrs;
}

/* The values `--check` compares. idle/nights/computedAt move with the clock
 * while the snapshot stands still, so they are reported, not compared. */
export function checkable(values) {
  return {
    "O3/KR4": { progress: values["O3/KR4"].progress, streak: values["O3/KR4"].derived.streak,
                lastCounted: values["O3/KR4"].derived.lastCounted, lastReset: values["O3/KR4"].derived.lastReset },
    "O3/KR1": { progress: values["O3/KR1"].progress, passes: values["O3/KR1"].derived.passes,
                fixturesExcluded: values["O3/KR1"].derived.fixturesExcluded },
  };
}

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  const now = process.env.OKR_NOW ? parseDt(process.env.OKR_NOW) : new Date();
  const runsDoc = readJson(RUNS_PATH, { runs: [] });
  const runs = Array.isArray(runsDoc.runs) ? runsDoc.runs : [];
  const fixtureText = existsSync(FIXTURE_PATH) ? readFileSync(FIXTURE_PATH, "utf8") : "";
  const okrs = readJson(OKRS_PATH, null);
  if (!okrs || !Array.isArray(okrs.objectives)) {
    console.error(`gen-okr-derived: ${relative(ROOT, OKRS_PATH)} unreadable`);
    return 1;
  }
  const values = derive({ runs, generatedAt: runsDoc.generatedAt, fixtureText, now });
  for (const [k, v] of Object.entries(values)) {
    console.log(`${k} progress=${v.progress} ${v.derived.note}`);
  }
  if (check) {
    const committed = {};
    for (const o of okrs.objectives) for (const kr of o.keyResults ?? []) {
      const key = `${o.id}/${kr.id}`;
      if (values[key]) committed[key] = kr;
    }
    const want = checkable(values);
    let drift = 0;
    for (const [key, w] of Object.entries(want)) {
      const kr = committed[key];
      const d = kr?.derived;
      if (!d || d.by !== SELF) { console.error(`gen-okr-derived: ${key} is not stamped derived by ${SELF}`); drift++; continue; }
      for (const [f, val] of Object.entries(w)) {
        const have = f === "progress" ? kr.progress : d[f];
        if (JSON.stringify(have) !== JSON.stringify(val)) {
          console.error(`gen-okr-derived: ${key}.${f} committed=${JSON.stringify(have)} recomputed=${JSON.stringify(val)}`);
          drift++;
        }
      }
    }
    if (drift) { console.error(`gen-okr-derived: ${drift} drift(s) — run \`node ${SELF}\` and commit data/okrs.json`); return 1; }
    console.log("gen-okr-derived: committed values match the snapshot");
    return 0;
  }
  applyDerived(okrs, values);
  writeFileSync(OKRS_PATH, JSON.stringify(okrs, null, 2) + "\n");
  console.log(`gen-okr-derived: wrote ${relative(ROOT, OKRS_PATH)} from ${FROM}${runsDoc.generatedAt ? ` (snapshot ${runsDoc.generatedAt})` : ""}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}

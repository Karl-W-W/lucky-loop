/* Proves the JS port of today_api._converged_nights against the Python it
 * ports, on three fixtures, without any network or box. Run:
 *   node --test scripts/gen-okr-derived.test.mjs      (npm run test:okr)
 * The Python module imports fastapi (not installed on every Mac); the harness
 * stubs the two names it touches so the FUNCTION under test is the real one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDerived, convergedNights, derive, fixtureSignature, idempotencyKey, isFixtureRun, parseDt, realDocuments,
} from "./gen-okr-derived.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PY_DIR = join(ROOT, "hermes", "plugins", "fleet", "dashboard");
const NOW = "2026-09-16T12:00:00Z";

const run = (finishedAt, terminationReason = "converged", extra = {}) =>
  ({ runId: finishedAt, finishedAt, terminationReason, graphVersion: "1.1.0", model: "m", item: {}, ...extra });

/* Three fixtures: (1) one converged night then idle nights = streak 1;
 * (2) two converged nights, a reset by a cap-exhausted pass, then one converged = streak 1 with lastReset;
 * (3) empty = all idle. Plus a boundary case: a pass at exactly 08:00Z belongs to the NEXT night's day, not this one. */
const FIXTURES = {
  oneNightThenIdle: [run("2026-09-09T01:40:32Z"), run("2026-09-09T01:50:04Z"), run("2026-08-25T14:50:06Z")],
  resetMidway: [run("2026-09-09T01:40:00Z"), run("2026-09-10T02:00:00Z"), run("2026-09-11T03:00:00Z", "converged"),
                run("2026-09-11T03:10:00Z", "cap_exhausted"), run("2026-09-13T01:30:00Z")],
  empty: [],
  boundary: [run("2026-09-09T08:00:00Z"), run("2026-09-09T19:59:59Z"), run("2026-09-09T20:00:00Z")],
};

function pythonNights(runs, now) {
  const dir = mkdtempSync(join(tmpdir(), "okr-port-"));
  const p = join(dir, "loop-runs.json");
  writeFileSync(p, JSON.stringify({ runs }));
  const code = `
import sys, types, json
from datetime import datetime, timezone
from pathlib import Path
fa = types.ModuleType("fastapi"); fa.APIRouter = lambda *a, **k: types.SimpleNamespace(get=lambda *a, **k: (lambda f: f))
fr = types.ModuleType("fastapi.responses"); fr.PlainTextResponse = object
sys.modules["fastapi"] = fa; sys.modules["fastapi.responses"] = fr
sys.path.insert(0, ${JSON.stringify(PY_DIR)})
import today_api
today_api.LL_RUNS = Path(${JSON.stringify(p)})
today_api._now_dt = lambda: datetime.fromisoformat(${JSON.stringify(now.replace("Z", "+00:00"))})
r = today_api._converged_nights()
print(json.dumps({"streak": r["streak"], "idle": r["idle"], "nights": r["nights"], "lastCounted": r.get("last_counted")}))
`;
  return JSON.parse(execFileSync("python3", ["-c", code], { encoding: "utf8" }));
}

for (const [name, runs] of Object.entries(FIXTURES)) {
  test(`convergedNights matches today_api._converged_nights: ${name}`, () => {
    const js = convergedNights(runs, parseDt(NOW));
    const py = pythonNights(runs, NOW);
    assert.deepEqual({ streak: js.streak, idle: js.idle, nights: js.nights, lastCounted: js.lastCounted }, py);
  });
}

test("reset names the night that reset it; a later converged night restarts at 1", () => {
  const r = convergedNights(FIXTURES.resetMidway, parseDt(NOW));
  assert.equal(r.streak, 1);
  assert.equal(r.lastReset, "2026-09-10");      // the 20:00Z window that held the cap_exhausted pass
  assert.equal(r.lastCounted, "2026-09-12");
});

test("empty snapshot: 0 nights counted, every completed night idle, note says no passes yet", () => {
  const r = convergedNights([], parseDt(NOW));
  assert.equal(r.streak, 0);
  assert.equal(r.idle, r.nights);
  const v = derive({ runs: [], generatedAt: undefined, fixtureText: "x\n", now: parseDt(NOW) });
  assert.equal(v["O3/KR4"].progress, 0);
  assert.equal(v["O3/KR4"].derived.note, "no passes yet");
  assert.equal(v["O3/KR1"].progress, 0);
  assert.equal(v["O3/KR1"].derived.note, "no passes yet");
});

test("the current, unfinished night is not counted (day-after rule)", () => {
  const r = convergedNights([run("2026-09-16T01:00:00Z")], parseDt("2026-09-16T05:00:00Z"));
  assert.equal(r.streak, 0);
  const later = convergedNights([run("2026-09-16T01:00:00Z")], parseDt("2026-09-16T08:00:00Z"));
  assert.equal(later.streak, 1);
});

test("parseDt mirrors _parse_dt: Z, offset, naive-as-UTC, garbage", () => {
  assert.equal(parseDt("2026-09-09T01:50:04Z").toISOString(), "2026-09-09T01:50:04.000Z");
  assert.equal(parseDt("2026-09-09T03:50:04+02:00").toISOString(), "2026-09-09T01:50:04.000Z");
  assert.equal(parseDt("2026-09-09T01:50:04").toISOString(), "2026-09-09T01:50:04.000Z");
  assert.equal(parseDt("nope"), null);
  assert.equal(parseDt(""), null);
});

test("the fixture is recognised by loop/run.py's idempotency key, else by its size", () => {
  const text = "Synthetic bill\nAmount 12.00\n";
  const key = idempotencyKey(text, "1.1.0", "llama3.2:3b");
  assert.equal(key.length, 16);
  assert.ok(isFixtureRun({ idempotencyKey: key, graphVersion: "1.1.0", model: "llama3.2:3b", item: {} }, text));
  const sig = fixtureSignature(text);
  assert.ok(isFixtureRun({ idempotencyKey: "0000000000000000", item: { chars: sig.chars, lines: sig.lines } }, text));
  assert.ok(!isFixtureRun({ idempotencyKey: "0000000000000000", item: { chars: 5, lines: 1 } }, text));
  const docs = realDocuments([
    { idempotencyKey: key, graphVersion: "1.1.0", model: "llama3.2:3b", item: { docType: "invoice" } },
    { idempotencyKey: "abc", item: { chars: 9, lines: 2, docType: "receipt" } },
    { idempotencyKey: "def", item: { chars: 9, lines: 3, docType: "receipt" } },
  ], text);
  assert.deepEqual(docs, { passes: 2, fixturesExcluded: 1, docTypes: ["receipt"] });
});

test("applyDerived stamps the two KRs, marks the rest declared, keeps key order and other fields", () => {
  const okrs = { objectives: [
    { id: "O3", keyResults: [ { id: "KR1", title: "t", progress: 0.2, note: "n" }, { id: "KR3", title: "u", progress: 0, note: "m", rubric: ["a"] } ] },
    { id: "O1", keyResults: [ { id: "KR1", title: "v", progress: 1 } ] },
  ] };
  const v = derive({ runs: FIXTURES.oneNightThenIdle, generatedAt: "2026-09-09T01:50:04Z", fixtureText: "", now: parseDt(NOW) });
  applyDerived(okrs, v);
  const [o3, o1] = okrs.objectives;
  assert.equal(o3.keyResults[0].progress, 0.3);
  assert.equal(o3.keyResults[0].derived.by, "scripts/gen-okr-derived.mjs");
  assert.deepEqual(Object.keys(o3.keyResults[0]), ["id", "title", "progress", "note", "derived"]);
  assert.equal(o3.keyResults[1].derived, false);
  assert.deepEqual(o3.keyResults[1].rubric, ["a"]);
  assert.equal(o1.keyResults[0].derived, false);
  assert.match(v["O3/KR4"].derived.note, /snapshot 2026-09-09T01:50:04Z/);
  // the static note carries no number: it cannot go stale
  assert.doesNotMatch(o3.keyResults[0].note, /\d+\/\d+/);
  assert.match(o3.keyResults[0].note, /gen-okr-derived\.mjs/);
});

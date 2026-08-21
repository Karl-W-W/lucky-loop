/**
 * Hop 5 — the only hop nothing automated.
 *
 * A pass runs on the DGX every ten minutes and writes `~/ll-loop/out/`. The
 * site renders `data/`. Between those two directories sat an rsync a human had
 * to remember, which is why a loop that ran unattended on 2026-08-11 still
 * needed a person before anyone could see it. Three manual steps become one
 * command; the COMMIT stays human, deliberately — this is a public repo and the
 * commit is the publication.
 *
 * It also writes `data/loop-status.json`, which is the more interesting half.
 *
 * WHY A STATUS FILE EXISTS AT ALL
 * The loop's health lives entirely on a box that nothing else in this project
 * can see: not Vercel, not GitHub, not the site, not any agent watching the
 * repo. So "no new pass in `data/`" has always been two different facts wearing
 * one face — the loop is starving, or nobody ran the sync — and no reader could
 * tell them apart. `loop-status.json` separates them. It carries the queue
 * depth, the scheduler's last and next tick, and the last tick's exit code,
 * sampled at `syncedAt`. A reader that shows any of it without showing
 * `syncedAt` has reintroduced the bug this file exists to kill.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 * Counts, never names. The inbox holds real mail and bills, so a filename is a
 * document title and a document title is the leak. The remote half returns
 * `len(...)` and never a filename, so the bytes that could leak are never
 * transported, rather than transported and then filtered. Same for hostnames
 * and paths: `data/loop-status.json` is committed to a PUBLIC repo, and a path
 * is a map of a private machine.
 *
 * THE REGRESSION GUARD IS COPIED, NOT INVENTED
 * `gen-ledger.mjs` already solved "a derive that silently returns less than the
 * committed truth" — it refuses to write and says why, keeping the committed
 * data. Same shape here: a DGX that answers with FEWER passes than are already
 * committed is a wiped `out/`, a restored box, or an ssh that half-failed, and
 * none of those should be able to delete published history with an rsync.
 *
 * Usage:
 *   npm run sync:loop              # pull, guard, write; commit stays yours
 *   npm run sync:loop -- --check   # report only, write nothing
 *   LL_DGX_HOST=other npm run sync:loop
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = join(REPO, "data", "loop-runs.json");
const DEF = join(REPO, "data", "loop-def.json");
const STATUS = join(REPO, "data", "loop-status.json");

const CHECK_ONLY = process.argv.includes("--check");
const HOST =
  process.argv.find((a) => a.startsWith("--host="))?.slice(7) ||
  process.env.LL_DGX_HOST ||
  "dgx-remote";

/* The remote half. Runs on the DGX, returns ONE json envelope on stdout.
 * Counts only — see the header. Everything it reads is already the loop's own
 * output or systemd's own bookkeeping; it writes nothing and needs no rights
 * beyond the login that the code-push rsync already uses. */
const PROBE = `
import json, os, subprocess, pathlib

base = pathlib.Path.home() / "ll-loop"

def artifact(name):
    try:
        return json.loads((base / "out" / name).read_text(encoding="utf-8"))
    except Exception:
        return None

def show(unit, props):
    try:
        out = subprocess.run(
            ["systemctl", "--user", "show", unit] + ["-p" + p for p in props],
            capture_output=True, text=True, timeout=15,
        ).stdout
        return dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    except Exception:
        return {}

def epoch(s):
    """systemd names these properties *USec* and then renders them as
    'Fri 2026-08-21 14:30:00 CEST'. Reading them as microseconds gives you the
    YEAR as a number of microseconds, i.e. 1970 — which is why this converts on
    the box that owns the clock and the timezone, and returns explicit seconds.
    --timestamp=unix would do it, but only for some of these properties, and a
    converter that works on three fields out of four is the worse bug."""
    if not s or s in ("n/a", "0", "infinity"):
        return None
    if s.startswith("@"):
        try:
            return int(float(s[1:]))
        except Exception:
            return None
    try:
        r = subprocess.run(["date", "-d", s, "+%s"], capture_output=True, text=True, timeout=10)
        v = r.stdout.strip()
        return int(v) if r.returncode == 0 and v else None
    except Exception:
        return None

def count(p):
    try:
        return len([q for q in p.iterdir() if q.is_file() and not q.name.startswith(".")])
    except Exception:
        return None

inbox = base / "inbox"
timer = show("lucky-loop.timer", ["ActiveState", "NextElapseUSecRealtime", "LastTriggerUSec"])
svc = show("lucky-loop.service", ["ExecMainStatus", "ExecMainExitTimestamp", "ActiveState"])

fail = None
try:
    lines = [l for l in (pathlib.Path.home() / "logs" / "lucky-loop-failures.log")
             .read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
    if lines:
        fail = lines[-1].split(" ", 1)[0]
except Exception:
    pass

print(json.dumps({
    "runs": artifact("loop-runs.json"),
    "def": artifact("loop-def.json"),
    "queueDepth": count(inbox),
    "processedCount": count(inbox / ".done"),
    "schedulerActive": timer.get("ActiveState") == "active",
    "lastTickEpoch": epoch(timer.get("LastTriggerUSec")),
    "nextTickEpoch": epoch(timer.get("NextElapseUSecRealtime")),
    "lastExit": svc.get("ExecMainStatus"),
    "lastExitEpoch": epoch(svc.get("ExecMainExitTimestamp")),
    "lastFailureEpoch": epoch(fail),
}))
`;

/* One unit crosses the wire: epoch SECONDS, converted on the host (see epoch()
 * in the probe). Anything that is not a real instant becomes null and stays
 * null all the way to the JSON — a zero rendered as a date is 1970, and 1970 on
 * a status board reads as a bug in the board rather than as "this never
 * happened". The first draft of this file shipped exactly that 1970, from
 * parsing a formatted timestamp as microseconds. */
function epochToIso(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/* run.py's exit contract, stated once here so a reader of the status file never
 * has to guess what `4` meant. 4 is the RESTING state of a ten-minute timer
 * with an empty queue, not a fault — the unit lists 0, 2 and 4 as success. */
const EXIT_MEANING = {
  0: "converged — a pass ran and its assertion held",
  2: "already-recorded — this item+graph+model had a pass; queue advanced",
  3: "FAILED — error, redaction violation, refused write-back, or cap exhausted",
  4: "idle — the inbox was empty, nothing to process",
};

function fail(msg) {
  console.error(`\n!! sync-loop: ${msg}\n`);
  process.exit(1);
}

function committedRunCount() {
  if (!existsSync(RUNS)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(RUNS, "utf8"));
    return Array.isArray(parsed.runs) ? parsed.runs.length : 0;
  } catch {
    return 0;
  }
}

let raw;
try {
  raw = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, "python3", "-"],
    { input: PROBE, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
} catch (err) {
  fail(
    `could not reach the loop host over ssh (${err.code || err.message}).\n` +
      `   Nothing was written — data/ still holds the last good sync.\n` +
      `   The tunnel is the only route to that box; check it before retrying.`,
  );
}

let probe;
try {
  probe = JSON.parse(raw);
} catch {
  fail("the host answered, but not with JSON. Refusing to write anything.");
}

if (!probe.runs || !Array.isArray(probe.runs.runs)) {
  fail("no readable loop-runs.json on the host — refusing to overwrite committed artifacts.");
}

const incoming = probe.runs.runs.length;
const committed = committedRunCount();

/* The guard. Same posture as gen-ledger.mjs: keep what is committed, say why. */
if (incoming < committed) {
  fail(
    `REFUSING to write — the host returned ${incoming} pass(es) but ${committed} ` +
      `are already committed.\n` +
      `   Published history does not shrink on the word of one ssh. Check the host's\n` +
      `   out/ directory before doing anything else; data/ is untouched.`,
  );
}

const docTypes = [...new Set(probe.runs.runs.map((r) => r?.item?.docType).filter(Boolean))].sort();
const last = probe.runs.runs.reduce(
  (acc, r) => (r.finishedAt && (!acc || r.finishedAt > acc) ? r.finishedAt : acc),
  null,
);
const exitCode = Number(probe.lastExit);

const status = {
  schema: 1,
  about:
    "Sampled from the loop host by scripts/sync-loop.mjs. A SNAPSHOT, not a feed: " +
    "every field below was true at syncedAt and says nothing about now. Show syncedAt " +
    "beside anything you render from this file.",
  syncedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  loop: {
    lastPassAt: last,
    passCount: incoming,
    docTypes,
    queueDepth: probe.queueDepth,
    processedCount: probe.processedCount,
    scheduler: {
      active: probe.schedulerActive === true,
      lastTickAt: epochToIso(probe.lastTickEpoch),
      nextTickAt: epochToIso(probe.nextTickEpoch),
    },
    lastTick: {
      exit: Number.isFinite(exitCode) ? exitCode : null,
      meaning: EXIT_MEANING[exitCode] ?? "unknown",
      at: epochToIso(probe.lastExitEpoch),
    },
    lastFailureAt: epochToIso(probe.lastFailureEpoch),
  },
};

const delta = incoming - committed;
console.log(
  `sync-loop: ${incoming} pass(es) on the host, ${committed} committed` +
    (delta > 0 ? ` — ${delta} NEW` : " — nothing new"),
);
console.log(
  `sync-loop: queue ${status.loop.queueDepth ?? "?"} waiting, ` +
    `${status.loop.processedCount ?? "?"} processed · last tick exit ` +
    `${status.loop.lastTick.exit} (${status.loop.lastTick.meaning})`,
);

if (CHECK_ONLY) {
  console.log("sync-loop: --check — nothing written.");
  process.exit(0);
}

writeFileSync(RUNS, JSON.stringify(probe.runs, null, 2) + "\n");
if (probe.def) writeFileSync(DEF, JSON.stringify(probe.def, null, 2) + "\n");
writeFileSync(STATUS, JSON.stringify(status, null, 2) + "\n");

console.log(
  "sync-loop: wrote data/loop-runs.json, data/loop-def.json, data/loop-status.json.\n" +
    "sync-loop: NOT committed. Run the gate and read the diff before you publish it:\n" +
    "             npm run check:redaction && git diff --stat data/",
);

/**
 * The failure channel — the one thing no surface has ever shown.
 *
 * WHY THIS EXISTS
 * The 2026-08-19 audit recorded that "failures are still invisible to every
 * UI", and on 2026-08-28 that was still true in the worst possible way: the
 * dead-man's switch had written exactly ONE line since 11 August, a launchd job
 * on the workstation had been failing on every retry for weeks with its own
 * error log pointed at a volume that is not mounted, and the Desktop's socket
 * to the loop host had been reaped 33 times in three days. Every one of those
 * is a real, current, ongoing failure. Not one of them appeared anywhere a
 * human would look.
 *
 * A dashboard that renders only successes is not a dashboard, it is a
 * advertisement. This file samples the failure side and writes it beside the
 * others so `/war` can render it.
 *
 * IT IS A SNAPSHOT, NOT A FEED — the same contract as loop-status.json, for the
 * same reason. Every field was true at `syncedAt` and says nothing about now.
 * Anything rendering a number from this file MUST render `syncedAt` beside it,
 * or it has reintroduced the bug the file exists to kill.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 * Counts and coarse kinds. Never a path, never a filename, never a session id,
 * never a hostname. This file is committed to a PUBLIC repo. A launchd label is
 * the name of a private project; an error-log path is a map of a private
 * machine; a stored session id is a handle to a live socket. The remote halves
 * return counts, so the bytes that could leak are never transported at all
 * rather than transported and then filtered — the rule sync-loop.mjs already
 * set. Unit names are carried ONLY for units this repository itself ships in
 * `deploy/`, because those are already public here.
 *
 * THE GUARD IS COPIED, NOT INVENTED
 * gen-ledger.mjs refuses to write when the derive returns less than the
 * committed truth. Same shape: a host that answers with a SMALLER lifetime
 * failure count than what is already committed means a rotated journal, a
 * rebuilt box, or a half-failed ssh — none of which should be able to erase a
 * recorded failure. Failures are the last thing that should silently vanish.
 *
 * Usage:
 *   npm run sync:failures            # sample, guard, write; commit stays yours
 *   npm run sync:failures -- --check # report only, write nothing
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "data", "failure-status.json");

const CHECK_ONLY = process.argv.includes("--check");
const HOST =
  process.argv.find((a) => a.startsWith("--host="))?.slice(7) ||
  process.env.LL_DGX_HOST ||
  "dgx-remote";
const WINDOW_DAYS = 7;

/* Units this repo ships. Only these may be named in the committed output; any
 * other failing unit is counted, never named. */
const OWN_UNITS = ["lucky-loop.service", "lucky-loop.timer", "nightly-queue.service"];

/* ---------------------------------------------------------------------------
 * The loop host. One json envelope on stdout, counts only.
 * ------------------------------------------------------------------------- */
const REMOTE = `
set -uo pipefail
W="${WINDOW_DAYS} days ago"
reap_w=$(journalctl --user -u hermes-serve.service --since "$W" --no-pager 2>/dev/null | grep -c ws_orphan_reap || echo 0)
reap_d=$(journalctl --user -u hermes-serve.service --since today --no-pager 2>/dev/null | grep -c ws_orphan_reap || echo 0)
reap_s=$(journalctl --user -u hermes-serve.service --since "$W" --no-pager 2>/dev/null | grep ws_orphan_reap | grep -o '"stored_session_id": "[^"]*"' | sort -u | wc -l || echo 0)
restarts=$(systemctl --user show hermes-serve.service -p NRestarts --value 2>/dev/null || echo "")
failed_named=""
failed_other=0
for u in $(systemctl --user list-units --state=failed --no-legend --plain 2>/dev/null | awk '{print $1}'); do
  case "$u" in
    lucky-loop.service|lucky-loop.timer|nightly-queue.service) failed_named="$failed_named$u," ;;
    *) failed_other=$((failed_other+1)) ;;
  esac
done
dm_last=""; dm_n=0
if [ -f "$HOME/logs/lucky-loop-failures.log" ]; then
  dm_n=$(wc -l < "$HOME/logs/lucky-loop-failures.log" | tr -d ' ')
  dm_last=$(tail -1 "$HOME/logs/lucky-loop-failures.log" | awk '{print $1}')
fi
printf '{"reapWindow":%s,"reapToday":%s,"reapSessions":%s,"restarts":"%s","failedNamed":"%s","failedOther":%s,"deadManEntries":%s,"deadManLast":"%s"}\\n' \
  "$reap_w" "$reap_d" "$reap_s" "$restarts" "$failed_named" "$failed_other" "$dm_n" "$dm_last"
`;

function remoteProbe() {
  const raw = execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=25", HOST, "bash -ls"], {
    input: REMOTE,
    encoding: "utf8",
    timeout: 90_000,
  });
  const line = raw.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (!line) throw new Error("loop host returned no envelope");
  return JSON.parse(line);
}

/* ---------------------------------------------------------------------------
 * The workstation. Local, and the ONLY place a launchd label is ever seen — it
 * is classified here and the label itself never reaches the output.
 * ------------------------------------------------------------------------- */
const EXIT_MEANING = {
  78: "configuration error — the job points at something that is not there",
  particular: null,
};

function localProbe() {
  let failing = 0;
  let kinds = new Set();
  try {
    const out = execFileSync("launchctl", ["list"], { encoding: "utf8" });
    for (const line of out.split("\n").slice(1)) {
      const [, statusRaw, label] = line.split("\t");
      if (!label || label.startsWith("com.apple.")) continue;
      const status = Number(statusRaw);
      if (!Number.isFinite(status) || status === 0) continue;
      failing += 1;
      kinds.add(status === 78 ? "configuration" : status === 255 ? "transport" : "other");
    }
  } catch {
    /* launchctl unavailable — report nothing rather than guess. */
  }

  /* Route deaths: the tunnel log is append-only and unrotated, so this is a
   * lifetime count, not a window. Each pair of "closed by remote host" +
   * "Broken pipe" is one route death, and one launchd restart behind it. */
  let routeDeaths = null;
  const log = join(process.env.HOME ?? "", "Library", "Logs", "spark-ollama-tunnel.log");
  try {
    if (existsSync(log)) {
      const txt = readFileSync(log, "utf8");
      routeDeaths = (txt.match(/closed by remote host/g) ?? []).length;
    }
  } catch {
    /* unreadable — leave null, which the panel renders as "not reported". */
  }

  return { failingJobs: failing, kinds: [...kinds].sort(), routeDeaths };
}

/* ------------------------------------------------------------------------- */
let remote;
try {
  remote = remoteProbe();
} catch (e) {
  console.error(`sync-failures: cannot reach the loop host (${HOST}) — ${e.message}`);
  console.error("  Nothing written. A snapshot that cannot see the host must not");
  console.error("  overwrite one that could: absent evidence is not evidence of health.");
  process.exit(1);
}
const local = localProbe();

const named = String(remote.failedNamed || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && OWN_UNITS.includes(s));

const status = {
  schema: 1,
  about:
    "The failure channel, sampled from the loop host and this workstation. A SNAPSHOT, not a feed: " +
    "every field was true at syncedAt and says nothing about now. Show syncedAt beside anything " +
    "rendered from this file. Counts and coarse kinds only — never a path, filename, session id or " +
    "launchd label, because this file is committed to a public repository.",
  syncedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  windowDays: WINDOW_DAYS,
  loopHost: {
    orphanReaps: {
      window: Number(remote.reapWindow) || 0,
      today: Number(remote.reapToday) || 0,
      distinctSessions: Number(remote.reapSessions) || 0,
    },
    serviceRestarts: remote.restarts === "" ? null : Number(remote.restarts),
    failedUnits: { named, otherCount: Number(remote.failedOther) || 0 },
    deadMan: {
      entries: Number(remote.deadManEntries) || 0,
      lastAt: remote.deadManLast || null,
    },
  },
  workstation: {
    failingJobs: local.failingJobs,
    kinds: local.kinds,
    routeDeaths: local.routeDeaths,
  },
};

/* The guard. A shrinking failure count is a lost record, not a fixed system. */
if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    const prevReap = prev?.loopHost?.orphanReaps?.window ?? 0;
    const prevDead = prev?.loopHost?.deadMan?.entries ?? 0;
    if (status.loopHost.orphanReaps.window < prevReap || status.loopHost.deadMan.entries < prevDead) {
      console.error("sync-failures: REFUSING to write — the host reported FEWER failures than are");
      console.error(`  already committed (reaps ${status.loopHost.orphanReaps.window} < ${prevReap},`);
      console.error(`  dead-man ${status.loopHost.deadMan.entries} < ${prevDead}).`);
      console.error("  That is a rotated journal or a half-failed probe, not a healthier system.");
      console.error("  Keeping the committed snapshot. Investigate the host before re-running.");
      process.exit(2);
    }
  } catch {
    /* unparseable previous file — treat as absent and write fresh. */
  }
}

const h = status.loopHost;
const w = status.workstation;
console.log(`sync-failures: sampled ${status.syncedAt}`);
console.log(`  loop host   reaps ${h.orphanReaps.today} today / ${h.orphanReaps.window} in ${WINDOW_DAYS}d` +
  ` across ${h.orphanReaps.distinctSessions} session(s) · hermes-serve restarts ${h.serviceRestarts ?? "?"}`);
console.log(`              failed units ${h.failedUnits.named.length} named + ${h.failedUnits.otherCount} other` +
  ` · dead-man ${h.deadMan.entries} entr${h.deadMan.entries === 1 ? "y" : "ies"}, last ${h.deadMan.lastAt ?? "never"}`);
console.log(`  workstation ${w.failingJobs} failing job(s) [${w.kinds.join(", ") || "none"}]` +
  ` · route deaths ${w.routeDeaths ?? "not reported"}`);

if (CHECK_ONLY) {
  console.log("  --check: nothing written.");
  process.exit(0);
}
writeFileSync(OUT, JSON.stringify(status, null, 2) + "\n");
console.log(`  wrote data/failure-status.json — the COMMIT stays yours.`);

#!/usr/bin/env node
/* Snapshot the gate workflows' runs on `main` for the public repos into
 * data/ci-runs.json — the committed source O3/KR3 is derived from at build
 * time (scripts/gen-okr-derived.mjs). Same shape of contract as
 * sync-deploys.mjs: this script talks to the network, LOCALLY; the build
 * never does. Run it, commit the result, and the KR follows.
 *
 *   node scripts/sync-ci.mjs                rewrite data/ci-runs.json
 *   node scripts/sync-ci.mjs --check        exit 1 if the committed snapshot lacks a
 *                                           completed run GitHub has (no writes)
 *   node scripts/sync-ci.mjs --out <path>   write somewhere else, leaving the checkout
 *                                           clean. The unattended caller
 *                                           (nightly-queue's ci-snapshot job) writes to
 *                                           the artifact-return staging dir, because a
 *                                           job that dirties the foreman's working
 *                                           checkout breaks the next `git pull --ff-only`.
 *   node scripts/sync-ci.mjs --floor <path> compare the fetch against this snapshot
 *                                           instead of --out's (defaults to --out).
 *
 * What is recorded, per run: repo, workflow, run number, the commit's short
 * sha, the created time and the conclusion. Nothing else — no actor, no
 * author, no email. Anonymous GitHub API (public repos, 60 req/h is plenty);
 * a non-2xx reply exits 1 and writes nothing. Cancelled runs are dropped: the
 * `gates` workflow cancels a superseded run on purpose (concurrency), which is
 * not a gate failure.
 *
 * THE FLOOR GUARD, AND WHAT IT DELIBERATELY DOES NOT GUARD (2026-09-19).
 * `gen-ledger.mjs` and `sync-loop.mjs` refuse to write when a fresh derive
 * returns FEWER rows than the snapshot already holds — a truncated source must
 * never erase recorded history. Copied, not reinvented: a fetch that has lost a
 * run the snapshot already records (a 5xx on page 2, a rate-limited reply, a
 * workflow renamed) is REFUSED and writes nothing.
 *
 * It floors the RUN SET, never the clean-day count. A floor on clean days would
 * read well — "the KR never goes down" — and would be the exact defect CLAUDE.md
 * names: a gate failure resets the streak to 0 BY DESIGN, and a guard that
 * refused to record that would make "zero gate failures" a number that cannot
 * fall, i.e. unfalsifiable. The failure is the signal. cleanDays falling is
 * printed loudly here and carried into the snapshot unchanged. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "ci-runs.json");
export const SINCE = "2026-09-10";           // O3/KR3: "streak counted from 2026-09-10"
export const GATES = [                       // the workflows that ARE the gates, per repo
  { repo: "Karl-W-W/lucky-loop", workflow: "gates" },
  { repo: "Karl-W-W/polysignal-engine", workflow: "Tests" },
];
const DROP = new Set(["cancelled", "skipped"]);

async function fetchRuns({ repo, workflow }) {
  const runs = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/repos/${repo}/actions/runs?branch=main&per_page=100&page=${page}&created=%3E%3D${SINCE}`;
    const res = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "lucky-loop sync-ci" } });
    if (!res.ok) throw new Error(`${repo}: HTTP ${res.status}`);
    const body = await res.json();
    const batch = body.workflow_runs ?? [];
    for (const r of batch) {
      if (r.name !== workflow || r.head_branch !== "main") continue;
      if (r.status !== "completed" || DROP.has(r.conclusion)) continue;
      runs.push({ repo, workflow, run: r.run_number, sha7: String(r.head_sha).slice(0, 7),
                  at: r.created_at, conclusion: r.conclusion });
    }
    if (batch.length < 100) break;
  }
  return runs;
}

export function readSnapshot(path = OUT) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return { runs: [] }; }
}

export const runKey = (r) => `${r.repo}#${r.run}`;

/* The floor. `incoming` is what GitHub just returned, `floor` is the snapshot we
 * are allowed to replace. Returns a list of refusal reasons — empty means write.
 * Rows only: see the header for why the clean-day count is NOT floored. */
export function floorViolations(incoming, floor) {
  const reasons = [];
  if (incoming.length < floor.length) {
    reasons.push(`fetch returned ${incoming.length} run(s), the snapshot already holds ${floor.length}`);
  }
  const have = new Set(incoming.map(runKey));
  const lost = floor.filter((r) => !have.has(runKey(r)));
  if (lost.length) {
    // Counts and ids only; these are public GitHub run numbers, never a filename.
    reasons.push(`${lost.length} recorded run(s) absent from the fetch: ${lost.slice(0, 5).map(runKey).join(", ")}`);
  }
  return reasons;
}

/* Read the argument after a flag, or null. */
function argOf(flag, argv) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const out = argOf("--out", argv) ? resolve(argOf("--out", argv)) : OUT;
  const floorPath = argOf("--floor", argv) ? resolve(argOf("--floor", argv)) : out;
  const all = (await Promise.all(GATES.map(fetchRuns))).flat().sort((a, b) => a.at.localeCompare(b.at));
  if (check) {
    const have = new Set(readSnapshot(floorPath).runs.map(runKey));
    const missing = all.filter((r) => !have.has(runKey(r)));
    for (const m of missing) console.error(`sync-ci: not in snapshot: ${m.repo} ${m.workflow} #${m.run} ${m.conclusion} ${m.at}`);
    console.log(`sync-ci: GitHub ${all.length} completed gate run(s) since ${SINCE}, snapshot has ${have.size}`);
    process.exit(missing.length ? 1 : 0);
  }

  const prev = readSnapshot(floorPath);
  const prevRuns = Array.isArray(prev.runs) ? prev.runs : [];
  const refusals = floorViolations(all, prevRuns);
  if (refusals.length) {
    for (const r of refusals) console.error(`sync-ci: REFUSING — ${r}`);
    console.error("sync-ci: nothing written; published history never shrinks on one fetch (see the header).");
    process.exit(1);
  }

  const doc = { syncedAt: new Date().toISOString(), since: SINCE, gates: GATES, runs: all };
  // Report the streak movement with the ONE definition that exists
  // (gen-okr-derived.mjs::ciCleanStreak — the build derives O3/KR3 from it).
  // A fall is news, not an error: it means a gate actually failed.
  const { ciCleanStreak } = await import("./gen-okr-derived.mjs");
  const before = prevRuns.length ? ciCleanStreak(prevRuns, new Date(prev.syncedAt ?? doc.syncedAt)) : null;
  const after = ciCleanStreak(all, new Date(doc.syncedAt));
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  const bad = all.filter((r) => r.conclusion !== "success").length;
  console.log(`sync-ci: wrote ${out} — ${all.length} run(s), ${bad} not successful, +${all.length - prevRuns.length} new`);
  console.log(`sync-ci: clean days ${before ? before.cleanDays : "-"} -> ${after.cleanDays} of ${after.windowDays} since ${after.cleanFrom}`);
  if (before && after.cleanDays < before.cleanDays) {
    console.log(`sync-ci: THE STREAK FELL — a gate failed. Reset by ${after.lastReset ? `${after.lastReset.repo} ${after.lastReset.workflow} #${after.lastReset.run} on ${after.lastReset.day}` : "an unrecorded run"}. Recorded, not suppressed.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`sync-ci: ${e.message}`); process.exit(1); });
}

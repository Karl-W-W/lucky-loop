#!/usr/bin/env node
/* Snapshot the gate workflows' runs on `main` for the public repos into
 * data/ci-runs.json — the committed source O3/KR3 is derived from at build
 * time (scripts/gen-okr-derived.mjs). Same shape of contract as
 * sync-deploys.mjs: this script talks to the network, LOCALLY; the build
 * never does. Run it, commit the result, and the KR follows.
 *
 *   node scripts/sync-ci.mjs           rewrite data/ci-runs.json
 *   node scripts/sync-ci.mjs --check   exit 1 if the committed snapshot lacks a
 *                                      completed run GitHub has (no writes)
 *
 * What is recorded, per run: repo, workflow, run number, the commit's short
 * sha, the created time and the conclusion. Nothing else — no actor, no
 * author, no email. Anonymous GitHub API (public repos, 60 req/h is plenty);
 * a non-2xx reply exits 1 and writes nothing. Cancelled runs are dropped: the
 * `gates` workflow cancels a superseded run on purpose (concurrency), which is
 * not a gate failure. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

export function readSnapshot() {
  try { return JSON.parse(readFileSync(OUT, "utf8")); } catch { return { runs: [] }; }
}

async function main() {
  const check = process.argv.includes("--check");
  const all = (await Promise.all(GATES.map(fetchRuns))).flat().sort((a, b) => a.at.localeCompare(b.at));
  if (check) {
    const have = new Set(readSnapshot().runs.map((r) => `${r.repo}#${r.run}`));
    const missing = all.filter((r) => !have.has(`${r.repo}#${r.run}`));
    for (const m of missing) console.error(`sync-ci: not in snapshot: ${m.repo} ${m.workflow} #${m.run} ${m.conclusion} ${m.at}`);
    console.log(`sync-ci: GitHub ${all.length} completed gate run(s) since ${SINCE}, snapshot has ${have.size}`);
    process.exit(missing.length ? 1 : 0);
  }
  writeFileSync(OUT, JSON.stringify({ syncedAt: new Date().toISOString(), since: SINCE, gates: GATES, runs: all }, null, 2) + "\n");
  const bad = all.filter((r) => r.conclusion !== "success").length;
  console.log(`sync-ci: wrote data/ci-runs.json — ${all.length} run(s), ${bad} not successful`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`sync-ci: ${e.message}`); process.exit(1); });
}

/**
 * sync-ops — three numbers for /war, nothing else (Karl, 2026-09-08):
 *   needsYou            open items in the vault's needs-you queue
 *   heartbeatsFresh     daemons fresh / registered, from `~/brain/tools/heartbeat check --json` (runs on the box)
 *   lapsConvergedUnattended   run-until-finished rows the foreman graded CONVERGED without a human
 *
 * Output: data/ops-status.json — a SNAPSHOT (render syncedAt beside it). Numbers only: no item text,
 * no hostnames, no paths from the vault ever reach this public repo.
 *   npm run sync:ops
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAIN = process.env.BRAIN_REPO || join(homedir(), "brain");
const OUT = join(ROOT, "data", "ops-status.json");

function needsYou() {
  const q = JSON.parse(readFileSync(join(BRAIN, "queue", "needs-you.json"), "utf8"));
  return q.items.filter((i) => !i.done).length;
}
function heartbeats() {
  // exit 1 means "a daemon is stale", which is a number to show, not a reason to fail the sync
  let raw;
  try { raw = execFileSync(join(BRAIN, "tools", "heartbeat"), ["check", "--json"], { encoding: "utf8", timeout: 60_000 }); }
  catch (e) { raw = e.stdout ? String(e.stdout) : ""; if (!raw.trim()) throw e; }
  const hb = JSON.parse(raw.trim().split("\n").pop());
  return { fresh: hb.fresh, total: hb.total, checkedAt: hb.now_utc };
}
function lapsConvergedUnattended() {
  const b = JSON.parse(readFileSync(join(BRAIN, "queue", "tasks.json"), "utf8"));
  return b.tasks.filter((t) => t.type === "run-until-finished" && t.status === "verified" && t.lastExit === "CONVERGED").length;
}

const snapshot = {
  schema: 1,
  about: "Three numbers from the ops layer, sampled by scripts/sync-ops.mjs. A SNAPSHOT: every field was true at syncedAt and says nothing about now. Numbers only by rule.",
  syncedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  needsYou: needsYou(),
  heartbeats: heartbeats(),
  lapsConvergedUnattended: lapsConvergedUnattended(),
};
writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`ops-status: needsYou=${snapshot.needsYou} heartbeats=${snapshot.heartbeats.fresh}/${snapshot.heartbeats.total} lapsConvergedUnattended=${snapshot.lapsConvergedUnattended} syncedAt=${snapshot.syncedAt}`);

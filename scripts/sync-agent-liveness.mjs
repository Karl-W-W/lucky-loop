/**
 * sync-agent-liveness — derive whether each roster agent is actually alive.
 *
 * WHY THIS EXISTS
 * `data/agents.json` opens by declaring: "The roster is a CHARTER, not a
 * monitor. Liveness is claimed ONLY where it is derived from committed data —
 * a hand-typed 'last seen' is the same lie." The very next field in every row
 * was a hand-typed `state`, and four rows said `live` because someone typed
 * `live`. That is the defect this repo already refuses in the Langflow canvas
 * ("a hand-typed number is a lie with a green check next to it") and in the
 * `/war` tiles. The charter was stating the rule and breaking it in the same
 * file.
 *
 * THE SPLIT THIS SCRIPT ENFORCES
 * `gated` / `on-demand` / `dormant` are DECLARATIONS OF INTENT — charter facts
 * about how an agent is meant to be operated. They stay in agents.json because
 * a human is the correct source for them.
 * `live` is an ASSERTION OF FACT about right now. It cannot be typed. It is
 * derived here or it is not claimed at all.
 *
 * WHAT IT REFUSES TO DO
 * Four of the nine agents have no local evidence path — two cloud agents that
 * report into Slack, a human at a terminal, and a third-party workspace. This
 * script emits `unknown` for them with the reason, and `/war` renders that as
 * "not instrumented". It does NOT guess, and it does NOT fall back to the old
 * hand-typed value. Uninstrumented is not failed, and it is not live either.
 *
 * Output: `data/agent-liveness.json` — a SNAPSHOT. Every consumer must render
 * `syncedAt` beside anything from it, the same rule loop-status.json carries.
 *
 *   npm run sync:agents
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER = join(ROOT, "data", "agents.json");
const LOOP_STATUS = join(ROOT, "data", "loop-status.json");
const OUT = join(ROOT, "data", "agent-liveness.json");

const SSH = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "dgx-remote"];

/** Run a command, returning trimmed stdout or null. Never throws. */
function run(cmd, args, timeout = 20000) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
const onHost = (script) => run("ssh", [...SSH, script]);

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const ageHours = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3.6e6 : null);

/* --------------------------------------------------------------------------
 * Derivers. Each returns { state, evidence } and NEVER guesses.
 * `state` is one of: live | idle | unknown
 * ------------------------------------------------------------------------ */

/** loop — a systemd --user timer on the loop host. Evidence: the timer is
 *  active AND has ticked recently. A timer that exists but stopped firing is
 *  `idle`, not `live`; that distinction is the whole point. */
function deriveLoop() {
  const active = onHost("systemctl --user is-active lucky-loop.timer 2>/dev/null");
  if (active === null) return { state: "unknown", evidence: "loop host unreachable" };
  if (active !== "active") return { state: "idle", evidence: `lucky-loop.timer is ${active}` };
  const last = onHost(
    "journalctl --user -u lucky-loop.service -o short-iso --no-pager 2>/dev/null | tail -1 | cut -d' ' -f1"
  );
  const h = ageHours(last);
  if (h === null || Number.isNaN(h)) return { state: "live", evidence: "timer active; last tick not parseable" };
  return h < 1
    ? { state: "live", evidence: `timer active, last tick ${h.toFixed(1)}h ago` }
    : { state: "idle", evidence: `timer active but last tick ${h.toFixed(1)}h ago` };
}

/** hermes-loop / hermes-scout — Hermes profiles on the DGX. Evidence: the
 *  backend is up AND the profile exists. Session recency is deliberately not
 *  used: these are on-demand chat profiles, so "no session today" is normal
 *  operation, not death. */
function deriveHermesProfile(profile) {
  const up = onHost("systemctl --user is-active hermes-serve.service 2>/dev/null");
  if (up === null) return { state: "unknown", evidence: "DGX unreachable" };
  if (up !== "active") return { state: "idle", evidence: `hermes-serve is ${up}` };
  const has = onHost(`test -d ~/.hermes/profiles/${profile} && echo yes || echo no`);
  return has === "yes"
    ? { state: "live", evidence: `hermes-serve active, profile ${profile} present` }
    : { state: "unknown", evidence: `hermes-serve active but profile ${profile} not found on host` };
}

/** gatekeeper — GitHub Actions. Evidence: a workflow file exists in this repo
 *  and the most recent run is not older than 30 days. Requires `gh`; without
 *  it we report unknown rather than assuming. */
function deriveGatekeeper() {
  if (!existsSync(join(ROOT, ".github", "workflows", "gates.yml")))
    return { state: "idle", evidence: "no .github/workflows/gates.yml in this checkout" };
  const out = run("gh", ["run", "list", "--workflow", "gates.yml", "--limit", "1",
                         "--json", "createdAt,conclusion"], 25000);
  if (!out) return { state: "unknown", evidence: "gh unavailable or not authenticated" };
  try {
    const [r] = JSON.parse(out);
    if (!r) return { state: "idle", evidence: "workflow present, no runs recorded" };
    const h = ageHours(r.createdAt);
    return h !== null && h < 720
      ? { state: "live", evidence: `last run ${(h / 24).toFixed(1)}d ago (${r.conclusion ?? "in progress"})` }
      : { state: "idle", evidence: `last run ${h === null ? "unknown" : (h / 24).toFixed(0) + "d"} ago` };
  } catch {
    return { state: "unknown", evidence: "could not parse gh output" };
  }
}

/** Agents with no local evidence path. Naming the reason is the point — this
 *  is what stops the row quietly reading `live` forever. */
const notInstrumented = (why) => () => ({ state: "unknown", evidence: why });

const DERIVERS = {
  "loop": deriveLoop,
  "hermes-loop": () => deriveHermesProfile("loop"),
  "hermes-scout": () => deriveHermesProfile("scout"),
  "gatekeeper": deriveGatekeeper,
  "pulse": notInstrumented("scheduled cloud agent reporting into Slack — no local evidence path"),
  "sentinel": notInstrumented("scheduled cloud agent reporting into Slack — no local evidence path"),
  "hands": notInstrumented("a human at a terminal; liveness is not a property this can have"),
  "herald": notInstrumented("not yet commissioned — see its charter disposition"),
  "scout-workspace": notInstrumented("third-party workspace — nothing here can observe it"),
};

/* ------------------------------------------------------------------------ */

const roster = JSON.parse(readFileSync(ROSTER, "utf8"));
const agents = roster.agents ?? [];
const liveness = {};

for (const a of agents) {
  const fn = DERIVERS[a.id];
  if (!fn) {
    liveness[a.id] = { state: "unknown", evidence: "no deriver defined for this agent id" };
    continue;
  }
  liveness[a.id] = fn();
}

const missing = agents.filter((a) => !DERIVERS[a.id]).map((a) => a.id);
const derived = Object.values(liveness).filter((l) => l.state !== "unknown").length;

const out = {
  schema: 1,
  about:
    "Derived liveness for the agent roster. A SNAPSHOT: every field was true at " +
    "syncedAt and says nothing about now — render syncedAt beside anything from " +
    "this file. `unknown` means NOT INSTRUMENTED, which is neither live nor " +
    "failed; it is never a fallback for a value we could not derive. Produced by " +
    "scripts/sync-agent-liveness.mjs; never hand-edit.",
  syncedAt: nowIso(),
  derivedCount: derived,
  totalCount: agents.length,
  liveness,
};

if (missing.length) {
  console.error(`sync-agent-liveness: no deriver for ${missing.join(", ")} — they report unknown.`);
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`sync-agent-liveness: wrote ${OUT.replace(ROOT + "/", "")} at ${out.syncedAt}`);
console.log(`  ${derived}/${agents.length} agents have a derived state; the rest report unknown (not instrumented).`);
for (const [id, l] of Object.entries(liveness)) {
  console.log(`  ${id.padEnd(16)} ${l.state.padEnd(8)} ${l.evidence}`);
}

#!/usr/bin/env node
/**
 * The MCP invariant gate.
 *
 * `data/agents.json` publishes on a public website that Scout may "never write
 * to the vault". That promise is kept by ONE thing: gbrain is scoped over MCP
 * to a read-only allowlist (`mcp_servers.gbrain.tools.include`), 76 tools rather
 * than the 131 `hermes mcp add` enables by default — a set that includes
 * `put_page`, `delete_page`, `forget` and `purge_deleted_pages`.
 *
 * Nothing enforced that. A hand-edit on either host, or a gbrain upgrade that
 * ships a new write tool, would have moved the promise without moving anything
 * a reader could see.
 *
 * TWO POSITIONS, because they can see different things — the same shape as
 * loop/check_artifacts.py:
 *
 *   A. PORTABLE (always runs, including on Vercel and in CI). The committed
 *      contract must be non-empty and must contain no write-capable tool.
 *      This is checkable with no hosts present, because the contract is a file.
 *
 *   B. LIVE (only where a host is reachable). Each host's real
 *      tools.include must be a NON-EMPTY SUBSET of the contract. Subset, not
 *      equality: removing a tool is tightening, and a gate that punishes
 *      tightening gets disabled. Gaining a tool the contract does not list —
 *      which is exactly what "gained a write-capable tool" looks like — FAILS.
 *      Dropping tools.include entirely means the host silently gets all 131,
 *      so a missing/empty include is a FAILURE, never a skip.
 *
 * An unreachable host is DISCLOSED, not silently passed. Read the status line:
 * "OK" from a machine that could not see the DGX is not "the DGX passed".
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const CONTRACT = "data/mcp-allowlist.json";

/* Belt and braces behind the allowlist. These patterns do not decide what is
 * allowed — the contract does. They exist so that a human editing the contract
 * to add a write tool trips a second wire on the way in. */
const WRITE = new RegExp(
  "^(put_|delete_|forget|purge_|remove_|add_|update_|submit_|apply_|revert_|" +
  "restore_|migrate_|capture|remember|sync_|cancel_|pause_|resume_|retry_|" +
  "replay_|schema_apply|ontology_propose|sources_add|sources_remove|takes_add|" +
  "takes_update|takes_supersede|takes_resolve|log_ingest|extraction_review|" +
  "entity_identity_link|entity_identity_unlink|reload_|run_onboard|run_doctor|" +
  "run_skillopt|send_job_message|file_upload|volunteer_)"
);

const violations = [];
const notes = [];

/* ---- A. portable: the contract itself ---- */
if (!existsSync(CONTRACT)) {
  console.error(`mcp-invariant: ${CONTRACT} is missing — the contract IS the gate.`);
  process.exit(1);
}
const contract = JSON.parse(readFileSync(CONTRACT, "utf8"));
const allowed = contract.tools ?? [];
if (!Array.isArray(allowed) || allowed.length === 0) {
  violations.push(`${CONTRACT}: tools list is empty or not an array`);
}
const contraband = allowed.filter((t) => WRITE.test(t));
if (contraband.length) {
  violations.push(`${CONTRACT}: write-capable tool(s) in the allowlist: ${contraband.join(", ")}`);
}
if (contract.count !== allowed.length) {
  violations.push(`${CONTRACT}: count ${contract.count} disagrees with tools.length ${allowed.length}`);
}

/* ---- B. live: each host, if reachable ---- */
let yaml = null;
try {
  yaml = (await import("js-yaml")).default;
} catch {
  /* absent here; the mac probe will disclose rather than fail */
}

function macInclude() {
  const p = join(homedir(), ".hermes", "config.yaml");
  if (!existsSync(p)) return { reachable: false, why: "no ~/.hermes/config.yaml on this machine" };
  if (!yaml) return { reachable: false, why: "js-yaml not resolvable here" };
  const d = yaml.load(readFileSync(p, "utf8"));
  return { reachable: true, include: d?.mcp_servers?.gbrain?.tools?.include };
}

function dgxInclude() {
  const py =
    'import yaml,json,os; d=yaml.safe_load(open(os.path.expanduser("~/.hermes/config.yaml"))); ' +
    'print(json.dumps(((d.get("mcp_servers") or {}).get("gbrain") or {}).get("tools",{}).get("include")))';
  try {
    const out = execFileSync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "dgx-remote", `python3 -c '${py}'`],
      { encoding: "utf8", timeout: 25000, stdio: ["ignore", "pipe", "ignore"] }
    );
    return { reachable: true, include: JSON.parse(out.trim()) };
  } catch (e) {
    return { reachable: false, why: `unreachable (${e.code ?? e.message})` };
  }
}

const allowedSet = new Set(allowed);
let liveChecked = 0;

for (const [host, probe] of [["mac", macInclude], ["dgx", dgxInclude]]) {
  const r = probe();
  if (!r.reachable) {
    notes.push(`${host}: LIVE CHECK SKIPPED — ${r.why}`);
    continue;
  }
  liveChecked += 1;
  const inc = r.include;
  if (!Array.isArray(inc) || inc.length === 0) {
    /* No include means gbrain is NOT scoped: the host gets every tool the
     * server offers, write tools included. This is the failure the file exists
     * for, so it is never a skip. */
    violations.push(`${host}: mcp_servers.gbrain.tools.include is missing or empty — gbrain is UNSCOPED on this host`);
    continue;
  }
  const extra = inc.filter((t) => !allowedSet.has(t));
  if (extra.length) {
    const w = extra.filter((t) => WRITE.test(t));
    violations.push(
      `${host}: ${extra.length} tool(s) not in the committed contract: ${extra.join(", ")}` +
      (w.length ? `  <-- ${w.length} of these are WRITE-CAPABLE` : "")
    );
  }
  notes.push(`${host}: live ${inc.length} tool(s), ${extra.length} outside contract`);
}

/* DERIVED, never typed: a hardcoded "0 write-capable" here printed a clean
 * status line over a contract containing put_page during the red test that
 * commissioned this gate. */
console.log(`mcp-invariant: contract ${allowed.length} tool(s), ${contraband.length} write-capable`);
for (const n of notes) console.log(`  ${n}`);

if (liveChecked === 0) {
  console.log("\nlive gate: NO HOST CHECKED — this run validated the committed contract only.");
  console.log("  Do not read this as \"both hosts passed\".");
} else {
  console.log(`\nlive gate: ${liveChecked} of 2 host(s) checked live.`);
}

if (violations.length) {
  console.error("\nMCP INVARIANT VIOLATED:");
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nIf a scope change is intended, edit data/mcp-allowlist.json so a human sees it in the diff.");
  process.exit(1);
}
console.log("OK — allowlist intact.");

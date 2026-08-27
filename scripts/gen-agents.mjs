/**
 * gen-agents — the agent factory.
 *
 * WHY THIS EXISTS
 * Until 2026-08-27 an agent existed twice and neither copy knew about the other:
 * a hand-typed row in `data/agents.json` that only `/war` displayed, and a
 * hand-written `SOUL.md` on whichever host happened to run it. Nothing generated
 * either, nothing compared them, and they had already drifted — Loop's SOUL on
 * the DGX still named the *Mac* repo path for its core procedure, because a
 * profile had been copied host-to-host by hand.
 *
 * That is the same class of defect this repo already refuses elsewhere: a
 * hand-typed number in the Langflow canvas is "a lie with a green check next to
 * it", so `gen-flow.py` derives node titles and `--check-drift` fails the build
 * when the committed canvas stops matching its source. Agents get the same
 * treatment. The registry is the source; the file on the box is the output.
 *
 * WHAT IS GENERATED, AND WHY THAT SPLIT
 * The charter — the display name, what an agent does, and every line of what it
 * may NEVER do — lives in `data/agents.json` and is rendered into BOTH the /war
 * roster and the agent's own SOUL. One source, two renderings, so the public
 * claim and the private instruction cannot disagree. The agent-specific
 * procedure stays prose in `agents/<profile>.soul.md`, because that is genuinely
 * per-agent writing and pretending it is data would help nobody.
 *
 * DRIFT IS CHECKED AGAINST A COMMITTED SNAPSHOT, NOT AGAINST THE HOST.
 * CI and Vercel cannot reach the DGX. So `--write` renders into
 * `agents/generated/<host>/<profile>/` and that output is committed; `--check`
 * re-renders and diffs against it, which is portable and runs anywhere. Proving
 * the BOX matches the snapshot is a separate, host-dependent step (`--deploy`,
 * which verifies a sha256 back off the host). Do not read a green `--check` as
 * "the DGX is current" — it means "the committed output matches the registry".
 * That distinction is exactly the one `--check` vs `--check-drift` draws for the
 * canvas, and it was not academic there either.
 *
 *   node scripts/gen-agents.mjs            regenerate the committed output
 *   node scripts/gen-agents.mjs --check    fail if the output is stale (CI-safe)
 *   node scripts/gen-agents.mjs --deploy   push to the hosts, verify by sha256
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(REPO, "agents", "generated");

/* Where each host is reached. Only `dgx` exists today; the map is here so that
 * adding a second host is a data change rather than a rewrite. */
const HOSTS = {
  dgx: { ssh: "dgx-remote", profilesDir: "/home/cube/.hermes/profiles" },
};

const MODE = process.argv.includes("--deploy")
  ? "deploy"
  : process.argv.includes("--check")
    ? "check"
    : "write";

/* The English lock and the no-narration rule are emitted for EVERY agent rather
 * than living in each template. Both were added after a bot broke them — qwen
 * drifted into Thai mid-answer, and a long prose SOUL produced a bot that
 * claimed to have written a file it never wrote. A rule that had to be learned
 * twice should not be re-typed per profile. */
const PREAMBLE = `**Always reply in English, whatever language the document or the question is in.
A German bill or a Thai receipt does not change the language you answer Karl in.**

**You act only by calling tools. You never describe an action you have not already
performed. You never say "next I will" or "please stand by" — you either call the
tool now, or you stop and wait for Karl.**`;

function asList(cannot) {
  return Array.isArray(cannot) ? cannot : [cannot];
}

/* The staging command is HOST-DEPENDENT, and getting that wrong is exactly the
 * bug this generator exists to kill: Loop's SOUL on the DGX carried the *Mac*
 * repo path for a fortnight because a profile had been copied by hand. A
 * profile that cannot stage now says so, in its own charter, instead of
 * carrying a command that fails obscurely at the terminal. */
function stagingBlock(agent, kind) {
  const st = agent.hermes.staging;
  const flag = kind === "publish" ? "--yes " : "";
  return "Call `terminal`, exactly:\n\n`cd " + st.repoPath + " && npm run feed:loop -- " + flag + "<path>`";
}

/* An absent capability must remove the WHOLE procedure, not one step of it.
 *
 * The first version of this replaced only the command inside Step 2 and left
 * Steps 1 and 3-5 in place. Measured 2026-08-27: Loop kept the procedure's
 * SHAPE and filled in the blanks — it read the document with its own tools and
 * reported "PII classes detected: None. Deny-list hits: 0" as though the gate
 * had run. It had not. A fabricated gate result is the single worst output this
 * agent can produce, because the gate is what stands between a document and a
 * PUBLIC repository.
 *
 * The lesson generalises past this agent: leaving a procedure standing while
 * removing its one real action is an invitation to improvise, and a model of
 * this size accepts. So the block between the STAGING-PROCEDURE markers is
 * replaced wholesale when the host cannot stage. */
function applyStaging(agent, template) {
  const st = agent.hermes.staging;
  const MARK = /<!-- STAGING-PROCEDURE -->[\s\S]*?<!-- \/STAGING-PROCEDURE -->/;

  if (st && st.available) {
    return template
      .replace(MARK, (m) => m)
      .replace("{{STAGE_CHECK}}", () => stagingBlock(agent, "check"))
      .replace("{{STAGE_PUBLISH}}", () => stagingBlock(agent, "publish"));
  }

  const why = st?.reason ?? "This host cannot run the staging command.";
  const refusal = `## You cannot stage from this host

${why}

**When Karl asks you to feed, stage or queue anything, reply with exactly this
line and nothing else:**

> ${st?.sayExactly ?? "I can't stage from this host."}

Then stop and wait. A prohibition is not a script — this IS the script. Say it
verbatim rather than composing your own version of it.

You do NOT have a fallback. In particular you never:

- open, read, summarise or describe the document instead. Reading it is not a
  smaller version of staging it — it is a different act he did not ask for.
- report PII classes, a deny-list count, a character count or "the shape" of
  anything. Those numbers come from the gate. If the gate did not run, you do
  not have them, and writing them anyway is inventing a safety result.
- copy, move or write the file anywhere, or offer to.
- suggest the command he should run. Naming the machine is enough.`;

  return template.replace(MARK, refusal);
}

function renderSoul(agent) {
  const h = agent.hermes;
  const template = fs.readFileSync(path.join(REPO, h.template), "utf8").trim();
  const never = asList(agent.cannot)
    .map((c) => `- ${c}`)
    .join("\n");

  const body = applyStaging(agent, template);

  return `<!-- GENERATED by scripts/gen-agents.mjs — DO NOT EDIT THIS FILE.
     Source: data/agents.json (charter) + ${h.template} (procedure).
     Editing it on the host is silently discarded by the next deploy, and
     \`npm run agents:check\` will fail until the registry is edited instead. -->

# ${h.displayName}

${PREAMBLE}

## What you are for

${agent.does}

## Never

${never}

${body}
`;
}

function renderProfileYaml(agent) {
  const h = agent.hermes;
  /* profile.yaml is what Hermes Desktop reads for its roster
   * (hermes_cli/profiles.py::read_profile_meta). Both fields were empty on
   * every profile, which is why the Desktop list showed bare ids and Karl
   * could not tell the two bots apart. description_auto stays false so
   * Hermes does not overwrite a description the registry owns. */
  const desc = agent.does.replace(/\s+/g, " ").trim();
  return `# GENERATED by scripts/gen-agents.mjs from data/agents.json — do not edit.
display_name: ${JSON.stringify(h.displayName)}
description: ${JSON.stringify(desc)}
description_auto: false
`;
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

const registry = JSON.parse(fs.readFileSync(path.join(REPO, "data", "agents.json"), "utf8"));
const managed = registry.agents.filter((a) => a.hermes);

if (managed.length === 0) {
  console.error("gen-agents: no agents carry a `hermes` block — nothing to generate.");
  process.exit(1);
}

/* Render everything first, so a template error fails before anything is written
 * or deployed. */
const rendered = managed.map((agent) => {
  const h = agent.hermes;
  if (!HOSTS[h.host]) {
    console.error(`gen-agents: agent ${agent.id} names unknown host ${JSON.stringify(h.host)}`);
    process.exit(1);
  }
  const dir = path.join(OUT_ROOT, h.host, h.profile);
  return {
    agent,
    dir,
    files: {
      "SOUL.md": renderSoul(agent),
      "profile.yaml": renderProfileYaml(agent),
    },
  };
});

if (MODE === "check") {
  const drifted = [];
  for (const r of rendered) {
    for (const [name, content] of Object.entries(r.files)) {
      const p = path.join(r.dir, name);
      const onDisk = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
      if (onDisk !== content) {
        drifted.push(`${r.agent.id}/${name}${onDisk === null ? " (missing)" : ""}`);
      }
    }
  }
  if (drifted.length) {
    console.error(`gen-agents: DRIFT — committed output is stale for:\n  ${drifted.join("\n  ")}`);
    console.error("Run `npm run agents:build` and commit the result.");
    process.exit(1);
  }
  console.log(
    `gen-agents: OK — ${managed.length} agent(s) match their registry entry. ` +
      "(SNAPSHOT only — this does NOT prove the host is current; use --deploy for that.)",
  );
  process.exit(0);
}

/* write + deploy both need the files on disk */
for (const r of rendered) {
  fs.mkdirSync(r.dir, { recursive: true });
  for (const [name, content] of Object.entries(r.files)) {
    fs.writeFileSync(path.join(r.dir, name), content);
  }
}

if (MODE === "write") {
  console.log(`gen-agents: wrote ${managed.length} agent(s) to agents/generated/`);
  for (const r of rendered) {
    console.log(`  ${r.agent.hermes.host}/${r.agent.hermes.profile}  ${r.agent.name}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ deploy
 * Copies the generated files to the host and verifies a sha256 back off it,
 * the same shape as scripts/feed-loop.mjs. It writes agent CONFIGURATION only:
 * never a secret, never config.yaml (which holds the endpoint and hook wiring
 * a human set up), and it starts and stops nothing. */
let failed = 0;
for (const r of rendered) {
  const host = HOSTS[r.agent.hermes.host];
  const remoteDir = `${host.profilesDir}/${r.agent.hermes.profile}`;

  const exists = execFileSync("ssh", [
    host.ssh,
    `test -d ${remoteDir} && echo yes || echo no`,
  ])
    .toString()
    .trim();
  if (exists !== "yes") {
    console.error(`  MISSING  ${r.agent.id} — ${remoteDir} does not exist on ${host.ssh}.`);
    console.error("           Create the profile first; this command configures, it does not create.");
    failed++;
    continue;
  }

  for (const [name, content] of Object.entries(r.files)) {
    const local = path.join(r.dir, name);
    execFileSync("scp", ["-q", local, `${host.ssh}:${remoteDir}/${name}`]);
    const remoteHash = execFileSync("ssh", [
      host.ssh,
      `sha256sum ${remoteDir}/${name} | cut -d" " -f1`,
    ])
      .toString()
      .trim();
    if (remoteHash !== sha256(content)) {
      console.error(`  MISMATCH ${r.agent.id}/${name} — sha256 differs after copy.`);
      failed++;
    } else {
      console.log(`  ok       ${r.agent.hermes.profile}/${name}  ${remoteHash.slice(0, 12)}`);
    }
  }
}

if (failed) {
  console.error(`gen-agents: ${failed} file(s) failed to deploy.`);
  process.exit(1);
}
console.log(
  `gen-agents: deployed ${managed.length} agent(s). ` +
    "Hermes reads SOUL.md per turn, so chats pick this up without a restart; " +
    "Desktop's roster refreshes on its next profile list.",
);

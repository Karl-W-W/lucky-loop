#!/usr/bin/env node
/* Build-time data derivation for /war (npm `prebuild`).
 *
 *   1. Growth Ledger — git commits -> data/ledger.json, plus the build stamp
 *      the War Room renders ("Data built ... UTC").
 *   2. Current deployment -> data/deploys.json (see capture-deploy.mjs).
 *
 * GUARDS. A truncated ledger is worse than a stale one, because it is silent.
 * Vercel checks out shallow, so `git log` SUCCEEDS and can return a single
 * commit — the old try/catch (which only handled git being absent) would then
 * overwrite the committed ledger and the Growth Ledger would vanish from prod.
 *
 *   git unavailable          -> keep the committed ledger
 *   derived < committed      -> keep the committed ledger, warn loudly
 *   shallow but not shorter  -> accept, and record `shallow: true` in the file
 *
 * The build is never failed: taking the site down over a stale ledger is worse
 * than shipping the committed one. The warning is loud in the build log.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { captureCurrentDeploy } from "./capture-deploy.mjs";

const LEDGER_URL = new URL("../data/ledger.json", import.meta.url);
const MAX_COMMITS = 200;
const UNIT_SEP = "\u001f"; // matches %x1f in the git pretty format

function git(args) {
  return execSync(`git ${args}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function readCommittedLedger() {
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_URL, "utf8"));
    return Array.isArray(parsed.commits) ? parsed.commits : [];
  } catch {
    return [];
  }
}

function deriveFromGit() {
  const raw = git(`log --pretty=format:%H%x1f%ct%x1f%s -n ${MAX_COMMITS}`);
  const commits = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ct, msg] = line.split(UNIT_SEP);
      return { sha, t: Number(ct) * 1000, msg };
    })
    .filter((c) => c.sha && Number.isFinite(c.t) && c.t > 0);
  // `git log` on a shallow clone succeeds and simply stops early — ask directly.
  const shallow = git("rev-parse --is-shallow-repository") === "true";
  return { commits, shallow };
}

const committed = readCommittedLedger();

let derived = null;
try {
  derived = deriveFromGit();
} catch {
  derived = null;
}

let commits = committed;
let shallow = false;
let source = "committed";

if (!derived) {
  console.log(
    `ledger: git unavailable — keeping committed data/ledger.json (${committed.length} commits)`,
  );
} else if (derived.commits.length < committed.length) {
  console.warn(
    "!! ledger: REFUSING to write data/ledger.json — " +
      `git log returned ${derived.commits.length} commits but the committed ledger has ${committed.length}. ` +
      (derived.shallow
        ? "This checkout is SHALLOW (Vercel's default): deepen it (git fetch --unshallow, or raise " +
          "the deploy's clone depth) to regenerate the Growth Ledger."
        : "Check the git history before rebuilding.") +
      " Shipping the committed ledger instead.",
  );
} else {
  commits = derived.commits;
  shallow = derived.shallow;
  source = "git";
  console.log(
    `ledger: ${commits.length} commits from git` +
      (shallow ? " (SHALLOW checkout — history beyond the clone depth is not included)" : ""),
  );
}

const newest = commits.reduce((max, c) => (c.t > max ? c.t : max), 0);

writeFileSync(
  LEDGER_URL,
  JSON.stringify({ generatedAt: newest, builtAt: Date.now(), source, shallow, commits }, null, 2) +
    "\n",
);

captureCurrentDeploy();

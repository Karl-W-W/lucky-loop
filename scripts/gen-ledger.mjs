#!/usr/bin/env node
/* Build-time data derivation for /war (npm `prebuild`).
 *
 *   1. Growth Ledger — git commits -> data/ledger.json, plus the build stamp
 *      the War Room renders ("Data built ... UTC").
 *   2. Current production deployment -> data/deploys.json (capture-deploy.mjs).
 *
 * ===========================================================================
 * LAUNCH-DAY RUNBOOK (2026-07-31)
 *
 * Run BOTH assertions AFTER the final production deploy reports READY. Either
 * one failing means a number rendered on /war is not git/Vercel ground truth.
 *
 * (1) THE GROWTH LEDGER REACHES HEAD — no silent truncation.
 *
 *       git -C <repo> checkout main && git pull --ff-only
 *       git rev-list --count HEAD                     # git truth, e.g. 12
 *       npm run build
 *       node -e 'console.log(require("./data/ledger.json").commits.length)'
 *       #  ^ must equal `git rev-list --count HEAD` (capped at MAX_COMMITS)
 *
 *       curl -s https://lucky-loop-one.vercel.app/war > /tmp/war.html
 *       grep -q 'history truncated' /tmp/war.html    # must EXIT 1 (absent)
 *       grep -q "$(git rev-parse --short=7 HEAD)" /tmp/war.html  # must EXIT 0
 *
 *     Together these prove the DEPLOYED build derived the whole history: the
 *     truncation caveat is absent AND the newest commit is on the page.
 *
 *     NB: do NOT assert `git rev-list --count HEAD` against the rendered
 *     "Commits · 7d to last commit" tile. That tile is a 7-DAY WINDOW, not a
 *     total, so it is legitimately smaller than the full count as soon as the
 *     history is older than 7 days. The LEDGER LENGTH is the number that must
 *     equal git; the tile is a window over it.
 *
 * (2) THE DEPLOY COUNT MATCHES VERCEL.
 *
 *       VERCEL_TOKEN=<read-scoped> node scripts/sync-deploys.mjs --check
 *       #  must exit 0. Non-zero prints the drift; rerun without --check and
 *       #  commit data/deploys.json (which redeploys, and self-heals).
 * ===========================================================================
 *
 * GUARDS. A truncated ledger is worse than a stale one, because it is silent.
 * Vercel checks out shallow (`--depth`), so `git log` SUCCEEDS and simply stops
 * at the clone floor: the naive script overwrites the committed ledger with a
 * short one and history quietly disappears from prod.
 *
 *   shallow checkout      -> try to deepen it (fetch --unshallow, then
 *                            --deepen=N), then re-check
 *   STILL shallow after   -> write the derived commits, but mark the file
 *                            `shallow: true` so /war renders the history as a
 *                            FLOOR ("history truncated at N commits") instead
 *                            of presenting a short list as the whole story
 *   derived < committed   -> keep the committed ledger, warn loudly
 *   git unavailable       -> keep the committed ledger
 *
 * The `shallow` flag is load-bearing, not decorative: app/war/data.ts exposes
 * it as isLedgerTruncated(), and both the "Commits · 7d" tile note and the
 * Growth Ledger heading carry the caveat. A flag nothing renders is not a
 * guard — it is a comment.
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
/* Deepen past MAX_COMMITS so the --deepen fallback can never itself become the
 * thing that truncates the ledger. */
const DEEPEN_TO = MAX_COMMITS + 50;

function git(args) {
  return execSync(`git ${args}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** True only for a genuinely shallow checkout; false when git cannot answer. */
function isShallow() {
  try {
    return git("rev-parse --is-shallow-repository") === "true";
  } catch {
    return false;
  }
}

/* Best-effort deepening. This ONLY runs when the repository is already shallow,
 * which is never true of a normal local clone — so a local build never touches
 * the network. Both commands are read-only w.r.t. the working tree and the
 * checked-out branch: they add history objects, they do not move any ref. */
function tryDeepen() {
  for (const cmd of ["fetch --unshallow --quiet", `fetch --deepen=${DEEPEN_TO} --quiet`]) {
    try {
      git(cmd);
      if (!isShallow()) {
        console.log(`ledger: deepened the shallow checkout via \`git ${cmd}\``);
        return true;
      }
    } catch {
      // No remote, no credentials, or nothing left to fetch — try the next form.
    }
  }
  return false;
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
  // Deepen BEFORE reading the log, so `git log` can see the full history.
  if (isShallow()) tryDeepen();

  const raw = git(`log --pretty=format:%H%x1f%ct%x1f%s -n ${MAX_COMMITS}`);
  const commits = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ct, msg] = line.split(UNIT_SEP);
      return { sha, t: Number(ct) * 1000, msg };
    })
    .filter((c) => c.sha && Number.isFinite(c.t) && c.t > 0);
  /* Re-check AFTER deepening. `git log` on a shallow clone succeeds and simply
   * stops early, so the count alone can never reveal truncation — ask git. This
   * is what decides whether the page must present the history as a floor. */
  return { commits, shallow: isShallow() };
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
        ? "This checkout is SHALLOW and could not be deepened (no remote or no credentials?): " +
          "raise the deploy's clone depth to regenerate the Growth Ledger."
        : "Check the git history before rebuilding.") +
      " Shipping the committed ledger instead.",
  );
} else {
  commits = derived.commits;
  shallow = derived.shallow;
  source = "git";
  if (shallow) {
    console.warn(
      `!! ledger: derived ${commits.length} commits, but this checkout is STILL SHALLOW after ` +
        "attempting to deepen it. The Growth Ledger is a FLOOR, not the full history — /war will " +
        `say "history truncated at ${commits.length} commits". Raise the deploy's clone depth.`,
    );
  } else {
    console.log(`ledger: ${commits.length} commits from git (full history)`);
  }
}

const newest = commits.reduce((max, c) => (c.t > max ? c.t : max), 0);

writeFileSync(
  LEDGER_URL,
  JSON.stringify({ generatedAt: newest, builtAt: Date.now(), source, shallow, commits }, null, 2) +
    "\n",
);

captureCurrentDeploy();

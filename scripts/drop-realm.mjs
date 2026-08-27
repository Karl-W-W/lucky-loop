/**
 * drop-realm — put a document where the nightly queue will actually read it.
 *
 * THIS IS NOT feed:loop, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * `feed:loop` stages a document into the LangGraph queue, which derives an
 * artifact and publishes it to a PUBLIC repository. That is why it has two
 * redaction gates, a consent gate, and a human who must say yes in a separate
 * turn. The gate is the control, and nothing about it is ceremony.
 *
 * A realm drop goes somewhere else entirely: into the PRIVATE vault
 * (github.com/Karl-W-W/brain, visibility PRIVATE, canonical copy the bare repo
 * on the DGX). The nightly queue reads those files and writes a memo to
 * `~/brain/captures/nightly/<date>-nightly-queue.md`, which is also private.
 * Nothing here is published, so there is no redaction gate — and a gate that
 * guards nothing would only teach you to click through gates.
 *
 * What this command DOES take seriously is the thing that actually goes wrong:
 * the vault has two homes (this Mac and the DGX) and the queue reads the DGX
 * copy. A file dropped locally and never pushed is invisible at 03:30. So this
 * pulls first, pushes after, and then VERIFIES the file is on the DGX rather
 * than assuming the push arrived.
 *
 * It reports the SHAPE of what it moved — name, size, type — never the content.
 * Same rule as feed-loop.mjs and sync-loop.mjs: the terminal it prints to is
 * often one an agent is reading.
 *
 *   npm run drop:realm                              list realms and their state
 *   npm run drop:realm -- phyto-farm notes.pdf      drop one or more files
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VAULT = process.env.BRAIN_REPO || path.join(os.homedir(), "brain");
const REALMS = path.join(VAULT, "realms");
const DGX = "dgx-remote";
const DGX_VAULT = "/home/cube/brain";

function die(msg) {
  console.error(`\ndrop-realm: ${msg}\n`);
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync("git", ["-C", VAULT, ...args], { encoding: "utf8", ...opts }).trim();
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

if (!fs.existsSync(path.join(VAULT, ".git"))) {
  die(`no vault at ${VAULT}. Set BRAIN_REPO if it lives somewhere else.`);
}
if (!fs.existsSync(REALMS)) {
  die(`${REALMS} does not exist. Pull the vault first: git -C ${VAULT} pull origin master`);
}

const listRealms = () =>
  fs
    .readdirSync(REALMS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(REALMS, d.name);
      const files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
      return { name: d.name, dir, files };
    });

const [realmArg, ...fileArgs] = process.argv.slice(2);
const realms = listRealms();

/* No arguments: show the state of every realm. This is the "what is going on"
 * view, and it is deliberately the default — running the command with no
 * arguments should never do something. */
if (!realmArg) {
  console.log("\nRealms — drop documents in, the 03:30 queue writes a memo.\n");
  for (const r of realms) {
    const state = r.files.length
      ? `${r.files.length} file(s) — the memo runs tonight`
      : "empty — memo reports “no source” and does not run";
    console.log(`  ${r.name.padEnd(14)} ${state}`);
    for (const f of r.files.slice(0, 5)) {
      console.log(`  ${" ".repeat(14)}   ${f}  ${human(fs.statSync(path.join(r.dir, f)).size)}`);
    }
  }
  console.log(`\n  Drop something:  npm run drop:realm -- <realm> <file> [more files...]`);
  console.log(`  Vault: ${VAULT} (PRIVATE — nothing here is published)\n`);
  process.exit(0);
}

const realm = realms.find((r) => r.name === realmArg);
if (!realm) {
  die(`no realm called "${realmArg}". Available: ${realms.map((r) => r.name).join(", ")}`);
}
if (fileArgs.length === 0) {
  die(`name at least one file to drop into ${realmArg}.`);
}

/* Validate every file BEFORE copying any, so a typo in the third argument does
 * not leave the first two half-committed. */
const files = fileArgs.map((f) => {
  const src = path.resolve(f);
  if (!fs.existsSync(src)) die(`no such file: ${f}`);
  const st = fs.statSync(src);
  if (st.isDirectory()) die(`${f} is a directory — name the files inside it instead.`);
  const base = path.basename(src);
  if (base.startsWith(".")) {
    die(
      `${base} starts with a dot. The queue's source gate skips dotfiles (same rule\n` +
        `  pick_item() uses for .done/), so this file would be invisible to it. Rename it.`,
    );
  }
  const dest = path.join(realm.dir, base);
  if (fs.existsSync(dest)) die(`${base} is already in ${realmArg}. Rename it or remove the old one.`);
  return { src, dest, base, size: st.size };
});

console.log(`\n  Vault: ${VAULT}  (PRIVATE — this is not the public repo, nothing is published)`);
console.log(`  Realm: ${realmArg}\n`);

/* Pull first. The DGX is canonical; committing on top of a stale local copy is
 * how you get a merge to resolve at 3am. */
try {
  git(["pull", "--ff-only", "origin", "master"], { stdio: ["ignore", "pipe", "pipe"] });
} catch {
  die(
    "could not fast-forward the vault from the DGX.\n" +
      `  Resolve it by hand: git -C ${VAULT} pull origin master`,
  );
}

for (const f of files) {
  fs.copyFileSync(f.src, f.dest);
  const ext = path.extname(f.base) || "(no extension)";
  console.log(`  added  ${f.base.padEnd(34)} ${human(f.size).padStart(9)}  ${ext}`);
}

git(["add", "--", path.relative(VAULT, realm.dir)]);
if (!git(["status", "--porcelain", "--", path.relative(VAULT, realm.dir)])) {
  die("nothing changed — the files are already committed.");
}
git(["commit", "-q", "-m", `realms(${realmArg}): ${files.length} document(s)`]);

try {
  git(["push", "-q", "origin", "master"], { stdio: ["ignore", "pipe", "pipe"] });
} catch {
  die(
    "committed locally but the PUSH FAILED — the DGX has not seen these files,\n" +
      "  so the 03:30 memo will still report “no source”.\n" +
      `  Retry: git -C ${VAULT} push origin master`,
  );
}

/* Verify on the DGX rather than trusting the push. The queue reads that copy,
 * and "committed on the Mac" has never been the same thing as "present where
 * the job runs". */
let landed = [];
try {
  landed = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", DGX, `ls -1 ${DGX_VAULT}/realms/${realmArg}/`],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
} catch {
  console.log(
    `\n  Pushed, but could not reach the DGX to confirm (cloudflared may be down).\n` +
      `  Check later:  ssh ${DGX} ls ${DGX_VAULT}/realms/${realmArg}/\n`,
  );
  process.exit(0);
}

const missing = files.filter((f) => !landed.includes(f.base));
if (missing.length) {
  die(
    `pushed, but ${missing.map((m) => m.base).join(", ")} is NOT on the DGX yet.\n` +
      `  The post-receive hook fast-forwards ~/brain there; check it ran.`,
  );
}

const sources = landed.filter((f) => !f.startsWith("."));
console.log(`\n  Confirmed on the DGX — ${realmArg} now holds ${sources.length} source file(s).`);
console.log(`  The memo runs at 03:30 and lands in ~/brain/captures/nightly/.\n`);

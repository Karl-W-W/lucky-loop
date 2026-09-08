#!/usr/bin/env node
/**
 * feed-from-bills — the nightly bills drop becomes the loop's queue.
 *
 * WHAT THIS CHANGES ABOUT HOP 0, SAID PLAINLY
 * `scripts/feed-loop.mjs` exists because choosing a document IS a control: the
 * loop derives an artifact and that artifact ends up in a PUBLIC repository.
 * Its `--yes` is a declared human step and its default does nothing. This
 * script runs UNATTENDED from the nightly queue, so it cannot ask. It does not
 * pretend the control vanished — it narrows it, in three ways, and every one of
 * them is a line of code below rather than a paragraph of intent:
 *
 *   1. CLASS, NOT DOCUMENT. The only source is
 *      ~/brain/realms/admin-billing/inbox/<date>/, the drop target of the
 *      nightly bills-to-vault job. That is the one realm whose vocabulary the
 *      loop actually has: ISSUER_KINDS/DOC_TYPES in loop/graph.py are billing
 *      words, and perceive() prompts "you classify a document for an admin
 *      triage queue". A car-export or farm document forced through that enum
 *      lands on other/other and is then judged by an assertion written for
 *      bills. Those realms have their own drop folders and their own memo jobs;
 *      this script must never read them, and it takes ONE directory for that
 *      reason. The standing authorisation is for the class "bills that arrived
 *      in Karl's own mailbox", not for "documents".
 *
 *   2. FEEDING IS NOT PUBLISHING. Nothing here writes to the repo, git, or the
 *      website. The loop writes its artifact to ~/ll-loop/out on this box;
 *      `npm run sync:loop` pulls it and deliberately DOES NOT COMMIT, so a
 *      human still reads the diff before the world does. That human step is
 *      untouched, and it is now the only one. Anyone changing sync:loop to
 *      commit by itself removes the last gate, and this comment is where they
 *      should find that out.
 *
 *   3. THE DEFAULT STILL DOES NOTHING. Without --feed this is a dry run: it
 *      prints what it would feed and writes not one byte. `--feed` is what the
 *      nightly passes. Same shape as feed-loop.mjs's --yes, and — like it —
 *      it is a DECLARED step, not an enforced one.
 *
 * The residual risk, stated rather than dressed up: a bill that arrives by mail
 * now reaches the loop with no human between. The redaction gates and the human
 * commit stand behind it; the choice of *which* document does not.
 *
 * WHAT IT SHOWS YOU, AND WHY IT IS NOT THE DOCUMENT
 * The same posture as feed-loop.mjs and sync-loop.mjs: SHAPE, never text, and
 * never a filename. A bill's filename is the issuer's name and an invoice
 * number — a document title, and the leak this project keeps refusing to
 * transport. Each candidate is printed as its date folder plus the first eight
 * hex of its sha256, which is enough for a human on this box to find it in the
 * state file and nothing to anyone reading the vault page this output lands on.
 *
 * IDEMPOTENT BY CONTENT, NOT BY MTIME
 * The state file records the sha256 of the source bytes AND of the extracted
 * text. A file re-saved by the mail job, or the same PDF arriving twice under
 * two uids, is not fed twice. A run that feeds nothing prints "0 new" and exits
 * 0 — that is the resting state, not a failure, the same rule the src: gate in
 * nightly-queue already uses for an empty realm.
 *
 * Usage:
 *   node scripts/feed-from-bills.mjs                 # dry run: say what it would feed
 *   node scripts/feed-from-bills.mjs --feed          # ...and actually write to the queue
 *   node scripts/feed-from-bills.mjs --max 5         # cap this run (default 3)
 *   node scripts/feed-from-bills.mjs --bills DIR --loop DIR --state FILE   # for tests
 *
 * Exit codes, chosen to fit the nightly queue's `fn` gate:
 *   0  fed something, or had nothing new to feed
 *   1  a real failure the queue should record as FAILED
 *   3  the loop host is missing name_tokens_local.py. Recorded as BLOCKED, the
 *      same shape as a missing credential, because it is the same kind of
 *      thing: a local secrets file the box has to be given back before any real
 *      document may cross. run.py fail-closes on it anyway — ten minutes later,
 *      into a journal nobody reads. Better to refuse here and say so.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const HOME = homedir();

const argv = process.argv.slice(2);
const FEED = argv.includes("--feed");
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BILLS = resolve(flag("--bills", process.env.LL_BILLS_DIR || join(HOME, "brain/realms/admin-billing/inbox")));
const LOOP = resolve(flag("--loop", process.env.LL_LOOP_HOME || join(HOME, "ll-loop")));
const STATE = resolve(
  flag("--state", process.env.LL_FEED_STATE || join(HOME, ".local/state/lucky-loop/feed-from-bills.json")),
);
const MAX = Number(flag("--max", process.env.LL_FEED_MAX || "3"));

/* Copied from feed-loop.mjs, not reinvented — including the reason. A scanned
 * page with no text layer extracts to a handful of stray glyphs and would sail
 * through as a "document"; the loop would then perceive nothing. 200 is well
 * under the smallest real item this loop has processed (1,868 chars). */
const MIN_CHARS = 200;

const INBOX = join(LOOP, "inbox");
const DENY_LIST = join(LOOP, "name_tokens_local.py");

function die(msg, code = 1) {
  console.error(`feed-from-bills: ${msg}`);
  process.exit(code);
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/* ---------------------------------------------------------------- extraction
 * The loop reads UTF-8 text: run.py does read_text() and nothing else, so a PDF
 * handed to it "succeeds" as mojibake. Same table as feed-loop.mjs. Anything
 * with no extractor is SKIPPED and reported, never fed and never marked done —
 * a nightly job must not die because something unusual landed in a folder, and
 * a silent drop would be worse than a line that keeps reappearing. */
const PLAIN_TYPES = new Set([".txt", ".md", ".csv", ".log", ".eml", ".json", ".xml", ""]);

function extract(path) {
  const ext = extname(path).toLowerCase();
  if (PLAIN_TYPES.has(ext)) return readFileSync(path, "utf8");
  if (ext === ".pdf") {
    // -layout keeps table columns readable, which is most of what a bill is.
    return sh("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"]);
  }
  return null;
}

function normalise(text) {
  return (
    text
      .replace(/^﻿/, "")
      .replace(/\x00/g, "")
      .replace(/\r\n?/g, "\n")
      .trim() + "\n"
  );
}

/* --------------------------------------------------------------- inspection
 * Delegated to the loop's OWN redact.py and graph.py — the copy under $LOOP,
 * which is the code the timer actually runs and the only copy that carries
 * name_tokens_local.py. A second implementation of PATTERNS in JS is how the
 * original redaction bug spread. */
const INSPECT = `
import json, sys
sys.path.insert(0, ${JSON.stringify(LOOP)})
import redact
from graph import vocabulary

raw = sys.stdin.read()
letters = sum(1 for c in raw if c.isalpha())
print(json.dumps({
    "chars": len(raw),
    "lines": len(raw.splitlines()),
    "letterRatio": round(letters / max(len(raw), 1), 3),
    "piiClasses": redact.find_violations(raw),
    "denyListTokens": len(redact.source_tokens(raw, vocabulary())),
    "localTokensLoaded": bool(redact.LOCAL_TOKENS_LOADED),
}))
`;

function inspect(text) {
  try {
    return JSON.parse(sh("python3", ["-c", INSPECT], { input: text }));
  } catch (err) {
    die(`could not inspect a document with ${LOOP}/redact.py (${String(err.message).split("\n")[0]}).`);
  }
}

/* ------------------------------------------------------------------- state */
function loadState() {
  if (!existsSync(STATE)) return { version: 1, entries: [] };
  try {
    const s = JSON.parse(readFileSync(STATE, "utf8"));
    if (!Array.isArray(s.entries)) throw new Error("no entries array");
    return s;
  } catch (err) {
    die(
      `${STATE} is not readable as state (${String(err.message).split("\n")[0]}).\n` +
        `   Refusing to run: an unreadable state file means "fed already" cannot be\n` +
        `   answered, and the wrong answer re-feeds documents. Fix or remove it.`,
    );
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE), { recursive: true });
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmp, STATE); // atomic: a half-written state file is a re-feed
}

/* ------------------------------------------------------------------- queue
 * Neutral naming, from feed-loop.mjs: pick_item() prints the filename to stdout
 * whenever the queue holds more than one item, and the unit sends stdout to the
 * journal. An inbox filename is a document title. item-NNN.txt carries none. */
function queueNames() {
  const names = [];
  for (const d of [INBOX, join(INBOX, ".done"), join(INBOX, ".failed")]) {
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isFile()) names.push(e.name);
  }
  return names;
}

function nextIndexAndStems() {
  const names = queueNames();
  let idx = 0;
  for (const n of names) {
    const m = /^item-(\d+)/.exec(n);
    if (m) idx = Math.max(idx, Number(m[1]));
  }
  return { idx, stems: new Set(names.map((n) => n.replace(/\.[^.]*$/, ""))) };
}

function queueDepth() {
  if (!existsSync(INBOX)) return 0;
  return readdirSync(INBOX, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith("."))
    .length;
}

/* --------------------------------------------------------------- candidates
 * One level of date folders under the bills inbox, plus any file dropped at its
 * top level. Dotfiles are skipped by the same rule pick_item() uses, which is
 * why the realm's `.README` explainer can never become a source. */
function candidates() {
  if (!existsSync(BILLS) || !statSync(BILLS).isDirectory()) return [];
  const out = [];
  const push = (p) => {
    if (!basename(p).startsWith(".") && statSync(p).isFile()) out.push(p);
  };
  for (const e of readdirSync(BILLS, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const p = join(BILLS, e.name);
    if (e.isDirectory()) {
      for (const f of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (f.isFile()) push(join(p, f.name));
      }
    } else if (e.isFile()) {
      push(p);
    }
  }
  return out;
}

/* A source reference a vault page may carry: the date folder and eight hex of
 * the content hash. Never the filename — that is the issuer and the invoice
 * number. The full path lives in the state file, which stays on this box. */
function ref(path, sha) {
  const folder = basename(dirname(path));
  return `${/^\d{4}-\d{2}-\d{2}$/.test(folder) ? folder : "(top level)"}/#${sha.slice(0, 8)}`;
}

/* -------------------------------------------------------------------- main */
if (!Number.isFinite(MAX) || MAX < 1) die(`--max must be a positive number, got "${MAX}".`);

if (!existsSync(INBOX)) {
  die(`${INBOX} does not exist — the loop was never installed on this box, or the path moved.`);
}
if (!existsSync(DENY_LIST)) {
  die(
    `${DENY_LIST} is missing, so the loop's name deny-list is the FICTIONAL default.\n` +
      `   run.py fail-closes on that for any non-synthetic item, so anything fed now would\n` +
      `   sit in the queue and exit 3 at the next tick. Restore the file first; nothing was fed.`,
    3,
  );
}

const state = loadState();
const fedRawShas = new Set(state.entries.map((e) => e.sourceSha256));
const fedTextShas = new Set(state.entries.map((e) => e.textSha256));
const fedPaths = new Set(state.entries.map((e) => e.sourcePath));

const found = candidates();
const skipped = [];
const staged = [];
let alreadyFed = 0;
let stateDirty = false;

let { idx, stems } = nextIndexAndStems();

for (const path of found) {
  const bytes = readFileSync(path);
  const rawSha = sha256(bytes);
  if (fedRawShas.has(rawSha) || fedPaths.has(path)) {
    alreadyFed += 1;
    continue;
  }

  let text;
  try {
    text = extract(path);
  } catch (err) {
    skipped.push(`${ref(path, rawSha)} — extraction failed (${String(err.message).split("\n")[0]})`);
    continue;
  }
  if (text === null) {
    skipped.push(`${ref(path, rawSha)} — no extractor for '${extname(path) || "(no extension)"}'; the loop reads UTF-8 text only`);
    continue;
  }

  text = normalise(text);
  if (text.trim().length < MIN_CHARS) {
    skipped.push(
      `${ref(path, rawSha)} — extracted ${text.trim().length} chars; a scanned page with no text ` +
        `layer looks exactly like this, so it needs OCR, not the loop`,
    );
    continue;
  }

  const textSha = sha256(Buffer.from(text, "utf8"));
  if (fedTextShas.has(textSha)) {
    // Different bytes, same document — a re-save by the mail job, or the same
    // PDF under two uids. Record it so it stops being reconsidered every night.
    alreadyFed += 1;
    state.entries.push({
      sourcePath: path,
      sourceSha256: rawSha,
      textSha256: textSha,
      item: state.entries.find((e) => e.textSha256 === textSha)?.item ?? null,
      fedAt: new Date().toISOString(),
      note: "duplicate text of an item already fed",
    });
    fedRawShas.add(rawSha);
    stateDirty = true;
    continue;
  }

  if (staged.length >= MAX) {
    skipped.push(`${ref(path, rawSha)} — held back: --max ${MAX} reached this run, it will be first next run`);
    continue;
  }

  idx += 1;
  const stem = `item-${String(idx).padStart(3, "0")}`;
  if (stems.has(stem)) die(`${stem} already exists in the queue. Refusing — a collision here re-runs or clobbers.`);
  stems.add(stem);

  staged.push({ path, stem, text, rawSha, textSha, info: inspect(text) });
}

console.log(
  `feed-from-bills: ${found.length} file(s) under the bills drop, ${alreadyFed} already fed, ` +
    `${staged.length} new, ${skipped.length} skipped. Queue depth ${queueDepth()}.`,
);

for (const s of staged) {
  const i = s.info;
  console.log(
    `  ${ref(s.path, s.rawSha)} -> ${s.stem}.txt · ${i.chars} chars · ${i.lines} lines · ` +
      `${Math.round(i.letterRatio * 100)}% letters`,
  );
  console.log(`      PII shapes gate 1 can see: ${i.piiClasses.length ? i.piiClasses.join(", ") : "none"}`);
  console.log(`      capitalised tokens gate 2 will deny-list: ${i.denyListTokens}`);
}
for (const s of skipped) console.log(`  SKIP ${s}`);

if (!staged.length) {
  // Nothing new is the resting state of a queue that is up to date, not a
  // fault — the same rule the src: gate uses for an empty realm.
  if (FEED && stateDirty) saveState(state); // duplicate-text records only
  console.log("feed-from-bills: nothing new to feed.");
  process.exit(0);
}

if (!FEED) {
  console.log(
    `feed-from-bills: DRY RUN — nothing was written. Re-run with --feed to queue ${
      staged.length === 1 ? "this document" : "these documents"
    }.`,
  );
  process.exit(0);
}

for (const s of staged) {
  // Write dot-prefixed, then rename: pick_item() skips dotfiles by its own rule
  // (`not p.name.startswith(".")`), so a tick that fires mid-write cannot pick
  // up half a document. The rename is atomic within the directory.
  const target = join(INBOX, `${s.stem}.txt`);
  const tmp = join(INBOX, `.${s.stem}.txt.partial`);
  writeFileSync(tmp, s.text, "utf8");
  renameSync(tmp, target);

  const back = sha256(readFileSync(target));
  if (back !== s.textSha) {
    // Take it back out ourselves. Leaving a suspect item in the queue means the
    // next tick — ten minutes away — processes bytes nothing vouched for, and
    // telling the operator to `rm` it assumes an operator is reading.
    rmSync(target, { force: true });
    die(`${s.stem}.txt landed with a different sha256 than it left with; it was removed from the queue again.`);
  }

  state.entries.push({
    sourcePath: s.path,
    sourceSha256: s.rawSha,
    textSha256: s.textSha,
    item: `${s.stem}.txt`,
    chars: s.info.chars,
    piiClasses: s.info.piiClasses,
    denyListTokens: s.info.denyListTokens,
    fedAt: new Date().toISOString(),
  });
  saveState(state); // after EVERY item: a crash mid-run must not re-feed the rest
  console.log(`feed-from-bills: fed ${ref(s.path, s.rawSha)} -> ${s.stem}.txt · sha256 verified in the queue.`);
}

console.log(
  `feed-from-bills: queue depth now ${queueDepth()} · one item per tick (lucky-loop.timer, every 10 min).\n` +
    `feed-from-bills: nothing was published. The artifacts still need a human: ` +
    `npm run sync:loop && npm run check:redaction && git diff --stat data/`,
);

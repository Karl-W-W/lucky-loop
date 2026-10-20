// The confirm gate, against a throwaway vault: no real queue, no network, no herdr.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ll-voice-gate-"));
const brain = join(root, "brain");
process.env.LL_BRAIN = brain;
process.env.LL_VOICE_STATE = join(root, "state");
process.env.LL_HERDR = "/usr/bin/false"; // every tell() fails closed, nothing reaches a pane
const card = (id, tier) => ({ id, tier, title: `card ${id}`, ask: "merge it?", why: "", default: "hold", options: ["hold", "merged"], done: false });
mkdirSync(join(brain, "queue"), { recursive: true });
writeFileSync(join(brain, "queue/needs-you.json"), JSON.stringify({ items: [card("a", 3), card("b", 3), card("c", 3)] }));
const git = (...a) => execFileSync("git", ["-C", brain, ...a], { stdio: "pipe" });
git("init", "-q", "-b", "master"); git("add", "."); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "q");
// no origin: the hub is "unreachable", so a recorded answer is spooled, never written

let T;
const tick = () => new Promise((r) => setTimeout(r, 5));
before(async () => { T = await import("./tools.mjs"); });
const spool = () => (existsSync(join(root, "state/pending-answers.jsonl")) ? readFileSync(join(root, "state/pending-answers.jsonl"), "utf8").trim().split("\n").filter(Boolean).length : 0);

test("bare confirm words, negations refused, Russian matches", () => {
  for (const ok of ["confirm", "Confirm.", "yes, confirm", "ja, bestätigt", "Ich bestätige", "подтверждаю", "да, подтверждаю"]) assert.ok(T.isBareConfirm(ok), ok);
  for (const no of ["don't confirm", "I can't confirm that", "nicht bestätigt", "не подтверждаю", "confirm the other one", "approve"]) assert.ok(!T.isBareConfirm(no), no);
});

test("a confirm said before the echo does not count; the model's own call does not count", async () => {
  const ctx = { callId: "c1" };
  T.hearUser("c1", "confirm"); await tick();
  assert.equal((await T.card_answer({ id: "a", word: "approve" }, ctx)).needs_confirm, true);
  assert.equal((await T.card_answer({ id: "a", word: "approve" }, ctx)).needs_confirm, true, "still waiting");
  assert.equal(spool(), 0);
});

test("only the latest echo can be confirmed, by Karl's next words, once", async () => {
  const ctx = { callId: "c2" };
  await T.card_answer({ id: "a", word: "approve" }, ctx);
  await T.card_answer({ id: "b", word: "approve" }, ctx); // replaces a's echo
  await tick(); T.hearUser("c2", "confirm"); await tick();
  assert.equal((await T.card_answer({ id: "a", word: "approve" }, ctx)).needs_confirm, true, "a's echo was replaced");
  // a's retry issued a NEW echo for a, replacing b's: b cannot ride on the confirm either
  assert.equal((await T.card_answer({ id: "b", word: "approve" }, ctx)).needs_confirm, true);
  await tick(); T.hearUser("c2", "yes, confirm"); await tick();
  const ok = await T.card_answer({ id: "b", word: "approve" }, ctx);
  assert.equal(ok.recorded, "spooled", "b confirmed by the next utterance");
  assert.equal(spool(), 1);
  assert.equal((await T.card_answer({ id: "c", word: "approve" }, ctx)).needs_confirm, true, "the confirm is spent");
});

test("a negation spends the echo", async () => {
  const ctx = { callId: "c3" };
  await T.card_answer({ id: "c", word: "approve" }, ctx);
  await tick(); T.hearUser("c3", "no, don't confirm"); await tick();
  T.hearUser("c3", "confirm"); await tick();
  assert.equal((await T.card_answer({ id: "c", word: "approve" }, ctx)).needs_confirm, true);
});

test("hold needs no confirm", async () => {
  const r = await T.card_answer({ id: "c", word: "hold" }, { callId: "c4" });
  assert.equal(r.recorded, "spooled");
});

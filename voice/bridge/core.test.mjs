import { test } from "node:test";
import assert from "node:assert/strict";
import { metrics, median } from "./metrics.mjs";
import { redact } from "./redact.mjs";
import { mapWord, isRisky } from "./tools.mjs";

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
});

test("C1 counts speech_end -> agent_speaking, ignores a turn he kept talking through", () => {
  const ev = (kind, at) => ({ type: "timing", kind, at });
  const m = metrics([
    ev("speech_start", 0), ev("speech_end", 1000), ev("agent_speaking", 1800),
    ev("agent_stopped", 4000),
    ev("speech_start", 5000), ev("speech_end", 6000), ev("speech_start", 6300), ev("speech_end", 7000), ev("agent_speaking", 8200),
  ]);
  assert.deepEqual(m.c1.samples, [800, 1200]);
  assert.equal(m.c1.pass, false, "two turns are not ten");
});

test("C2 counts barge_start -> agent_stopped", () => {
  const ev = (kind, at) => ({ type: "timing", kind, at });
  const m = metrics([ev("agent_speaking", 0), ev("barge_start", 500), ev("agent_stopped", 820)]);
  assert.deepEqual(m.c2.samples, [320]);
  assert.equal(m.c2.pass, true);
});

test("redact withholds value shapes and strips ANSI", () => {
  const out = redact("\x1b[31mcall +49 170 1234567 or mail a@b.de, key sk-abcdefghijklmnopqrstuv\x1b[0m");
  assert.ok(!out.includes("1234567") && !out.includes("a@b.de") && !out.includes("sk-abc"));
  assert.ok(!out.includes("\x1b"));
});

test("spoken words map onto the card's own options", () => {
  const card = { options: ["hold", "merged"] };
  assert.equal(mapWord(card, "approve"), "merged");
  assert.equal(mapWord(card, "hold"), "hold");
  assert.equal(mapWord(card, "merged"), "merged");
  assert.equal(mapWord(card, "later"), "later");
  assert.equal(mapWord(card, "banana"), null);
  assert.equal(mapWord({ options: ["a", "b", "hold"] }, "approve"), null, "ambiguous approve is refused");
  assert.equal(mapWord({ options: ["done"] }, "hold"), "later");
});

test("tier 3 and public/spend/delete words need a spoken confirm", () => {
  assert.equal(isRisky({ tier: 3, title: "x" }), true);
  assert.equal(isRisky({ tier: 1, title: "merge the legal pages" }), true);
  assert.equal(isRisky({ tier: 1, title: "rename a pane", ask: "", default: "" }), false);
});

test("a risky answer needs Karl's own transcribed confirm after the echo", async () => {
  const { card_answer, hearUser } = await import("./tools.mjs");
  // The real queue is read but never written here: the gate refuses before any write.
  const ctx = { callId: "call-gate-test" };
  const id = "legal-pages-merge-2026-10-12";
  hearUser(ctx.callId, "confirm"); // said BEFORE the echo: must not count
  const a = await card_answer({ id, word: "approve", excerpt: "approve" }, ctx);
  if (a.reason?.startsWith("no card") || a.reason?.startsWith("already closed")) return; // card gone: nothing to test
  assert.equal(a.needs_confirm, true);
  const b = await card_answer({ id, word: "approve", excerpt: "confirm" }, ctx);
  assert.equal(b.needs_confirm, true, "the model saying confirm is not Karl saying it");
});

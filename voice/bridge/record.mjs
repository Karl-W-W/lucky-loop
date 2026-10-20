// Hang-up: the call becomes one record (transcript, decisions, actions, timings) in the call's
// private folder on this Mac, and the commander, the one vault writer, files it (check C6).
// Nothing here is ever written inside the public repo.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { callDir, tell } from "./tools.mjs";
import { metrics } from "./metrics.mjs";
import { redact } from "./redact.mjs";

export function readEvents(callId) {
  const f = join(callDir(callId), "events.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export async function writeCallRecord({ callId, conversationId, transcript = [] }) {
  if (!callId) return { ok: false, error: "no callId" };
  const events = readEvents(callId);
  const m = metrics(events);
  const decisions = events.filter((e) => e.type === "card_answer" || e.type === "card_change");
  const actions = events.filter((e) => ["tell", "ask", "spawn_lane"].includes(e.type));
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    `title: "Voice call ${callId}"`,
    "type: call",
    `date: ${date}`,
    "source: voice",
    `conversation: ${conversationId || "unknown"}`,
    `turns: ${transcript.length}`,
    "---",
    "",
    `# Voice call ${callId}`,
    "",
    "## Decisions",
    ...(decisions.length ? decisions.map((d) => `- ${d.t} · card \`${d.id}\` = ${d.answer || "change"}${d.code !== undefined ? ` (queue exit ${d.code})` : ""}`) : ["- none"]),
    "",
    "## Actions",
    ...(actions.length ? actions.map((a) => `- ${a.t} · ${a.type} → ${a.pane || "commander"}${a.code ? ` (exit ${a.code})` : ""}`) : ["- none"]),
    "",
    "## Timings",
    `- first audio after Karl stops (C1): median ${m.c1.median_ms ?? "n/a"} ms over ${m.c1.n} turns`,
    `- barge-in stop (C2): median ${m.c2.median_ms ?? "n/a"} ms over ${m.c2.n} interruptions`,
    "",
    "## Transcript",
    ...transcript.map((x) => `- **${x.role === "user" ? "Karl" : "Commander"}** (${x.t || ""}): ${redact(String(x.text || "")).replace(/\n/g, " ")}`),
    "",
  ];
  const path = join(callDir(callId), "record.md");
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  const told = await tell({
    pane: "commander",
    text: `[voice] Call ${callId} ended (${transcript.length} turns, ${decisions.length} decisions, ${actions.length} actions). You are the one vault writer: file ${path} into the vault as captures/calls/${date}-${callId}.md now (C6 is graded on 60 s from hang-up).`,
  }, { callId });
  return { ok: true, record: path, handed_to_commander: told.sent === true, metrics: m };
}

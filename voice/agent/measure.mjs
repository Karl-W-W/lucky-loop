// Pick the Commander's LLM by measurement, not by reputation (VOICE GO: "measure 2 or 3 hosted
// models that call tools reliably, pick by median latency over 10 turns, log the numbers").
//
// For each model: point the agent at it, open one text-in / audio-out conversation over the
// signed-URL websocket, send 10 typed turns (5 of which must trigger a named tool), and time
// user_message -> first audio chunk. Tool calls are answered with canned data, so nothing real
// is touched. Results go to ~/.local/state/lucky-loop/voice/measure-<stamp>.json.
//   node agent/measure.mjs [model ...]      then: node agent/deploy.mjs --apply --llm <winner>
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readKey } from "../bridge/keychain.mjs";
import { STATE } from "../bridge/tools.mjs";
import { deploy } from "./deploy.mjs";
import { median } from "../bridge/metrics.mjs";

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ["claude-haiku-5-5", "gemini-3.5-flash", "gpt-5.4-mini"];
const TURNS = [
  ["What's the status?", "fleet_status"],
  ["Okay. Anything blocked?", null],
  ["Which cards are open?", "cards_list"],
  ["Give me your recommendation on the first one in one sentence.", null],
  ["How is the box?", "box_health"],
  ["Wie steht es mit den Zielen?", "okr_status"],
  ["Gut. Und was macht der Commander gerade?", null],
  ["Tell the commander: measuring latency, ignore this.", "tell"],
  ["Thanks. Summarise in one sentence.", null],
  ["What should I decide first today?", null],
];
const CANNED = {
  fleet_status: { summary: "5 agents: 2 working, 3 idle, 0 blocked.", agents: [] },
  cards_list: { open: 2, cards: [{ id: "demo-card", ask: "Merge the legal pages?", options: ["hold", "merged"], needs_confirm: true }] },
  box_health: { reachable: false, say: "The box is unreachable." },
  okr_status: { objectives: [{ objective: "Sell the first Setup", key_results: [] }] },
  tell: { sent: false, reason: "measurement run: not sent" },
};

async function signedUrl(agentId) {
  const key = await readKey();
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, { headers: { "xi-api-key": key } });
  if (!r.ok) throw new Error(`signed url: ${r.status}`);
  return (await r.json()).signed_url;
}

function runConversation(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const results = [];
    let turn = -1;
    let sentAt = 0;
    let gotAudio = false;
    let toolSeen = null;
    let quietTimer = null;
    const next = () => {
      if (turn >= 0) results.push({ text: TURNS[turn][0], want_tool: TURNS[turn][1], tool: toolSeen, first_audio_ms: gotAudio ? gotAudio - sentAt : null });
      turn++;
      if (turn >= TURNS.length) { ws.close(); return resolve(results); }
      gotAudio = false; toolSeen = null;
      sentAt = performance.now();
      ws.send(JSON.stringify({ type: "user_message", text: TURNS[turn][0] }));
    };
    // A turn is over when audio has gone quiet for 1.5 s (tool round-trips included).
    const settle = () => { clearTimeout(quietTimer); quietTimer = setTimeout(next, 1500); };
    ws.onopen = () => ws.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
    ws.onerror = (e) => reject(new Error("websocket error " + (e.message || "")));
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "ping") ws.send(JSON.stringify({ type: "pong", event_id: ev.ping_event.event_id }));
      if (ev.type === "audio") {
        if (turn >= 0 && !gotAudio) gotAudio = performance.now();
        settle();
      }
      if (ev.type === "client_tool_call") {
        const c = ev.client_tool_call;
        toolSeen = toolSeen || c.tool_name;
        ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: JSON.stringify(CANNED[c.tool_name] || {}), is_error: false }));
        clearTimeout(quietTimer);
      }
    };
    setTimeout(() => reject(new Error("conversation timed out")), 5 * 60_000);
  });
}

const report = { at: new Date().toISOString(), turns: TURNS.length, models: {} };
for (const llm of MODELS) {
  try {
    const { agent_id } = await deploy({ llm });
    const rows = await runConversation(await signedUrl(agent_id));
    const lat = rows.map((r) => r.first_audio_ms).filter((x) => x !== null);
    const wanted = rows.filter((r) => r.want_tool);
    const hits = wanted.filter((r) => r.tool === r.want_tool).length;
    report.models[llm] = { median_first_audio_ms: median(lat), tool_hits: `${hits}/${wanted.length}`, rows };
    console.log(`${llm}: median ${median(lat)} ms to first audio over ${lat.length} turns · tools ${hits}/${wanted.length}`);
  } catch (e) {
    report.models[llm] = { error: String(e.message || e) };
    console.log(`${llm}: ${e.message || e}`);
  }
}
const ok = Object.entries(report.models).filter(([, v]) => v.median_first_audio_ms != null && Number(v.tool_hits.split("/")[0]) === Number(v.tool_hits.split("/")[1]));
ok.sort((a, b) => a[1].median_first_audio_ms - b[1].median_first_audio_ms);
report.winner = ok[0]?.[0] || null;
const out = join(STATE, `measure-${report.at.replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(`winner (all tools called, lowest median): ${report.winner ?? "none"} · ${out}`);
if (report.winner) {
  const s = await deploy({ llm: report.winner });
  console.log(`agent now on ${s.llm}`);
}

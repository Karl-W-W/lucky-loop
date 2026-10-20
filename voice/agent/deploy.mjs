// Agents-as-code for the Commander: commander.json + prompt.md -> one ElevenAgents agent.
//   node agent/deploy.mjs            print the body that would be sent (no network)
//   node agent/deploy.mjs --apply    create the agent, or update it in place
//   --llm <model>                    override the LLM (used by measure.mjs)
// The agent id is kept in ~/.local/state/lucky-loop/voice/agent.json, never in the repo.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readKey } from "../bridge/keychain.mjs";
import { STATE } from "../bridge/tools.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.elevenlabs.io";
const AGENT_FILE = join(STATE, "agent.json");

export function buildBody({ llm, voiceId } = {}) {
  const spec = JSON.parse(readFileSync(join(HERE, "commander.json"), "utf8"));
  const cc = structuredClone(spec.conversation_config);
  cc.agent.prompt.prompt = readFileSync(join(HERE, "prompt.md"), "utf8");
  if (llm) cc.agent.prompt.llm = llm;
  cc.agent.prompt.tools = spec.client_tools.map((t) => ({
    type: "client",
    expects_response: true,
    response_timeout_secs: t.name === "card_answer" ? 90 : 20,
    // A few words ("Checking.") while the tool runs: first audio does not wait on the Mac.
    pre_tool_speech: t.name === "end_call" ? "off" : "force",
    ...t,
  }));
  if (voiceId) cc.tts.voice_id = voiceId;
  return { name: spec.name, conversation_config: cc, platform_settings: spec.platform_settings };
}

async function xi(path, init = {}) {
  const key = await readKey();
  const r = await fetch(API + path, { ...init, headers: { "xi-api-key": key, "content-type": "application/json", ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path}: ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function pickVoice() {
  const spec = JSON.parse(readFileSync(join(HERE, "commander.json"), "utf8"));
  const { voices = [] } = await xi("/v1/voices");
  for (const want of spec.voice_preference) {
    const v = voices.find((x) => x.name?.split(" ")[0].toLowerCase() === want.toLowerCase());
    if (v) return v;
  }
  if (!voices[0]) throw new Error("no voices on this account");
  return voices[0];
}

export function savedAgent() {
  return existsSync(AGENT_FILE) ? JSON.parse(readFileSync(AGENT_FILE, "utf8")) : null;
}

export async function deploy({ llm } = {}) {
  const prev = savedAgent();
  const voice = prev?.voice_id ? { voice_id: prev.voice_id, name: prev.voice_name } : await pickVoice();
  const body = buildBody({ llm, voiceId: voice.voice_id });
  let id = prev?.agent_id;
  if (id) await xi(`/v1/convai/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  else id = (await xi("/v1/convai/agents/create", { method: "POST", body: JSON.stringify(body) })).agent_id;
  const saved = { agent_id: id, voice_id: voice.voice_id, voice_name: voice.name, llm: body.conversation_config.agent.prompt.llm, at: new Date().toISOString() };
  writeFileSync(AGENT_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
  return saved;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const llm = args.includes("--llm") ? args[args.indexOf("--llm") + 1] : undefined;
  if (!args.includes("--apply")) {
    const b = buildBody({ llm });
    b.conversation_config.agent.prompt.prompt = `<${b.conversation_config.agent.prompt.prompt.length} chars from prompt.md>`;
    console.log(JSON.stringify(b, null, 2));
  } else {
    const s = await deploy({ llm });
    console.log(`agent ${s.agent_id} · voice ${s.voice_name} · llm ${s.llm}`);
  }
}

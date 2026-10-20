// The voice bridge: 127.0.0.1 only. Serves the call page, mints ElevenLabs signed URLs with the
// Keychain key, and runs the Commander's client tools on this Mac.
//
// Hardening, because any web page Karl has open can fire requests at 127.0.0.1:
//   - bound to 127.0.0.1, never 0.0.0.0 (C7);
//   - the Host header must be this origin (stops DNS rebinding);
//   - every /api call carries a per-boot token that only the served page knows, in a custom
//     header (a cross-site page cannot read the token, and the header forces a CORS preflight
//     this server never answers).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readKey } from "./keychain.mjs";
import * as T from "./tools.mjs";
import { writeCallRecord } from "./record.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "../page");
const VENDOR = join(HERE, "../node_modules/@elevenlabs/client/dist/lib.iife.js");
const PORT = Number(process.env.LL_VOICE_PORT || 4711);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const TOKEN = randomBytes(24).toString("hex");
const AGENT_FILE = join(T.STATE, "agent.json");

function agentId() {
  if (process.env.LL_VOICE_AGENT_ID) return process.env.LL_VOICE_AGENT_ID;
  if (existsSync(AGENT_FILE)) return JSON.parse(readFileSync(AGENT_FILE, "utf8")).agent_id;
  return null;
}

const TOOLS = {
  fleet_status: () => T.fleet_status(),
  cards_list: () => T.cards_list(),
  card_answer: (p, ctx) => T.card_answer(p, ctx),
  tell: (p, ctx) => T.tell(p, ctx),
  ask: (p, ctx) => T.ask(p, ctx),
  spawn_lane: (p, ctx) => T.spawn_lane(p, ctx),
  box_health: () => T.box_health(),
  okr_status: () => T.okr_status(),
};

const calls = new Map(); // callId -> { started, caffeinate }

function send(res, code, body, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(data);
}

async function body(req) {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 2_000_000) throw new Error("body too large");
  }
  return s ? JSON.parse(s) : {};
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/call.js": ["call.js", "text/javascript; charset=utf-8"],
  "/call.css": ["call.css", "text/css; charset=utf-8"],
};

async function handle(req, res) {
  if (!HOSTS.has(req.headers.host || "")) return send(res, 421, { error: "wrong host" });
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    // The page carries no token: `bin/call` opens it with the token in the URL fragment,
    // read from bridge.json (mode 600), so a GET from anywhere else gets nothing usable.
    return send(res, 200, readFileSync(join(PAGE, file), "utf8"), type);
  }
  if (req.method === "GET" && url.pathname === "/vendor/elevenlabs.js") {
    return send(res, 200, readFileSync(VENDOR, "utf8"), "text/javascript; charset=utf-8");
  }
  if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
  if (req.headers["x-ll-token"] !== TOKEN) return send(res, 403, { error: "forbidden" });

  if (req.method === "GET" && url.pathname === "/api/fleet") return send(res, 200, await T.fleet_status());

  if (req.method === "POST" && url.pathname === "/api/session") {
    const id = agentId();
    if (!id) return send(res, 503, { error: "no agent yet: run `npm run agent:deploy` in voice/" });
    const key = await readKey();
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`,
      { headers: { "xi-api-key": key } });
    if (!r.ok) return send(res, 502, { error: `ElevenLabs said ${r.status}` });
    const { signed_url } = await r.json();
    const callId = `call-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
    // Keep the Mac awake for the life of the call: caffeinate exits when the call ends.
    const caf = spawn("/usr/bin/caffeinate", ["-dimsu", "-t", String(4 * 3600)], { stdio: "ignore" });
    calls.set(callId, { started: Date.now(), seen: Date.now(), caffeinate: caf });
    T.logEvent({ callId }, { type: "session", agent_id: id });
    return send(res, 200, { signedUrl: signed_url, callId });
  }

  const m = url.pathname.match(/^\/api\/tool\/([a-z_]+)$/);
  if (req.method === "POST" && m) {
    const fn = TOOLS[m[1]];
    if (!fn) return send(res, 404, { error: `no tool ${m[1]}` });
    const { callId, params } = await body(req);
    const ctx = { callId };
    const t0 = Date.now();
    try {
      const result = await fn(params || {}, ctx);
      T.logEvent(ctx, { type: "tool", name: m[1], ms: Date.now() - t0, ok: true });
      return send(res, 200, result);
    } catch (e) {
      T.logEvent(ctx, { type: "tool", name: m[1], ms: Date.now() - t0, ok: false });
      return send(res, 200, { error: String(e.message || e).slice(0, 300) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    const { callId, events, said } = await body(req);
    const call = calls.get(callId);
    if (call) call.seen = Date.now();
    if (said) T.hearUser(callId, said);
    for (const ev of (events || []).slice(0, 500)) T.logEvent({ callId }, { type: "timing", ...ev });
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/inbox") {
    return send(res, 200, { answers: T.takeAnswers(url.searchParams.get("callId")) });
  }

  if (req.method === "POST" && url.pathname === "/api/end") {
    const b = await body(req);
    const call = calls.get(b.callId);
    if (call) {
      call.caffeinate.kill();
      calls.delete(b.callId);
    }
    const out = await writeCallRecord(b);
    return send(res, 200, out);
  }

  return send(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: String(e.message || e).slice(0, 300) }));
});

// A tab closed without hanging up stops sending heartbeats: let the Mac sleep again.
setInterval(() => {
  for (const [id, c] of calls) {
    if (Date.now() - c.seen > 180_000) { // hidden tabs throttle timers to ~1/min
      c.caffeinate.kill();
      calls.delete(id);
      T.logEvent({ callId: id }, { type: "abandoned" });
    }
  }
}, 15_000).unref();

server.listen(PORT, "127.0.0.1", () => {
  writeFileSync(join(T.STATE, "bridge.json"), JSON.stringify({ pid: process.pid, port: PORT, token: TOKEN, at: new Date().toISOString() }), { mode: 0o600 });
  console.log(`voice bridge on http://127.0.0.1:${PORT}/ (pid ${process.pid})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const c of calls.values()) c.caffeinate.kill();
    process.exit(0);
  });
}

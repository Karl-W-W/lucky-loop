// The call page: one button, live captions, the agent strip. Every tool runs on the bridge.
(() => {
  const TOKEN = document.querySelector('meta[name="ll-token"]').content;
  const $ = (id) => document.getElementById(id);
  const btn = $("call");
  const stateEl = $("state");
  const captions = $("captions");

  const api = async (path, body) => {
    const r = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-ll-token": TOKEN, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return r.json();
  };

  const setState = (text, cls = "") => { stateEl.textContent = text; stateEl.className = `state ${cls}`; };

  let conv = null;
  let callId = null;
  let conversationId = null;
  let transcript = [];
  let mode = "listening";
  let timings = [];
  let inboxTimer = null;
  let flushTimer = null;

  // ---- timing events for C1 / C2 ----
  const stamp = () => performance.timeOrigin + performance.now();
  const mark = (kind) => timings.push({ kind, at: stamp() });
  const flush = () => {
    if (!callId || !timings.length) return;
    const events = timings; timings = [];
    api("/api/events", { callId, events }).catch(() => {});
  };

  const VAD_ON = 0.6, VAD_OFF = 0.35;
  let voiced = false;
  let lastVoiced = 0;
  const onVad = ({ vadScore }) => {
    const t = stamp();
    if (!voiced && vadScore >= VAD_ON) {
      voiced = true;
      if (mode === "speaking") mark("barge_start"); else mark("speech_start");
      btn.classList.add("hearing");
    }
    if (vadScore >= VAD_OFF) lastVoiced = t;
    if (voiced && vadScore < VAD_OFF) {
      voiced = false;
      timings.push({ kind: "speech_end", at: lastVoiced });
      btn.classList.remove("hearing");
    }
  };

  // ---- captions ----
  const caption = (role, text) => {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = role === "user" ? "You" : "Commander";
    li.append(who, document.createTextNode(text));
    captions.append(li);
    li.scrollIntoView({ block: "end" });
    transcript.push({ role, text, t: new Date().toISOString() });
  };

  // ---- client tools: each is one bridge call; the result goes back to the agent as text ----
  const tool = (name) => async (params) => {
    const r = await api(`/api/tool/${name}`, { callId, params });
    return JSON.stringify(r);
  };
  const clientTools = {
    fleet_status: tool("fleet_status"),
    cards_list: tool("cards_list"),
    card_answer: tool("card_answer"),
    tell: tool("tell"),
    ask: tool("ask"),
    spawn_lane: tool("spawn_lane"),
    box_health: tool("box_health"),
    okr_status: tool("okr_status"),
    end_call: async () => { setTimeout(() => hangUp(), 2500); return "Hanging up after your goodbye."; },
  };

  // ---- answers to ask() arrive later; never block the talk ----
  const pollInbox = async () => {
    if (!conv || !callId) return;
    const { answers = [] } = await api(`/api/inbox?callId=${encodeURIComponent(callId)}`).catch(() => ({}));
    for (const a of answers) {
      conv.sendContextualUpdate(`Answer from pane ${a.pane} to "${a.question}": ${a.answer}`);
      conv.sendUserMessage(`(fleet, not Karl) The answer from ${a.pane} is in. Tell Karl in two sentences: ${a.answer}`);
    }
  };

  // ---- fleet strip ----
  const drawFleet = async () => {
    const f = await api("/api/fleet").catch(() => null);
    if (!f || !f.agents) return;
    const ul = $("fleet");
    ul.replaceChildren(...f.agents.map((a) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = `dot ${a.status}`;
      li.append(dot, document.createTextNode(`${a.name} · ${a.status} · ${a.project}${a.commander ? " · commander" : ""}`));
      return li;
    }));
    $("fleet-at").textContent = new Date(f.taken_at).toLocaleTimeString();
  };

  async function call() {
    btn.disabled = true;
    setState("Connecting…");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const s = await api("/api/session", {});
      if (!s.signedUrl) throw new Error(s.error || "no session");
      callId = s.callId;
      transcript = [];
      captions.replaceChildren();
      conv = await ElevenLabsClient.Conversation.startSession({
        signedUrl: s.signedUrl,
        connectionType: "websocket",
        clientTools,
        onConnect: ({ conversationId: id }) => { conversationId = id; setState("Live. Talk.", "live"); },
        onDisconnect: () => finish(),
        onError: (msg) => setState(`Error: ${msg}`, "err"),
        onMessage: ({ message, role, source }) => caption(role === "user" || source === "user" ? "user" : "agent", message),
        onModeChange: ({ mode: m }) => {
          if (m === mode) return;
          mode = m;
          mark(m === "speaking" ? "agent_speaking" : "agent_stopped");
          btn.classList.toggle("speaking", m === "speaking");
        },
        onInterruption: () => mark("agent_stopped"),
        onVadScore: onVad,
      });
      btn.textContent = "Hang up";
      btn.setAttribute("aria-pressed", "true");
      flushTimer = setInterval(flush, 2000);
      inboxTimer = setInterval(pollInbox, 3000);
    } catch (e) {
      setState(`Could not start: ${e.message || e}`, "err");
      conv = null;
    } finally {
      btn.disabled = false;
    }
  }

  async function hangUp() {
    if (conv) await conv.endSession().catch(() => {});
  }

  let finishing = false;
  async function finish() {
    if (finishing || !callId) return;
    finishing = true;
    clearInterval(flushTimer); clearInterval(inboxTimer);
    flush();
    setState("Saving the call…");
    const r = await api("/api/end", { callId, conversationId, transcript }).catch(() => ({}));
    setState(r.ok ? "Call saved. The commander files it." : "Call ended; saving failed — the record is on this Mac.", r.ok ? "" : "err");
    conv = null; callId = null; mode = "listening"; finishing = false;
    btn.textContent = "Call";
    btn.setAttribute("aria-pressed", "false");
    btn.classList.remove("speaking", "hearing");
  }

  btn.addEventListener("click", () => (conv ? hangUp() : call()));
  document.addEventListener("keydown", (e) => {
    if (e.target !== document.body) return;
    if (e.code === "Space" && !conv) { e.preventDefault(); call(); }
    if (e.code === "Escape" && conv) hangUp();
  });

  drawFleet();
  setInterval(drawFleet, 15000);
})();

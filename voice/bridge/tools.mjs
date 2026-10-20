// The Commander's client tools, executed on the Mac. The page calls these over 127.0.0.1;
// every result is short, redacted text meant to be summarised aloud, never read out.
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { clip, redact } from "./redact.mjs";

const HOME = homedir();
export const STATE = process.env.LL_VOICE_STATE || join(HOME, ".local/state/lucky-loop/voice");
const BRAIN = process.env.LL_BRAIN || join(HOME, "brain");
const REPO = process.env.LL_REPO || join(HOME, "Projects/lucky-loop");
const HERDR = process.env.LL_HERDR || join(HOME, ".local/bin/herdr");
const NYW = join(BRAIN, "tools/needs-you-write");
// The commander's pane, as named in the voice lane's brief. Overridable, never guessed.
export const COMMANDER = process.env.LL_COMMANDER_PANE || "w2:pX";
const SPOOL = join(STATE, "pending-answers.jsonl");

mkdirSync(STATE, { recursive: true, mode: 0o700 });

export function run(cmd, args, { timeout = 20_000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

const now = () => new Date().toISOString();

// ---------- fleet ----------

export async function herdrAgents() {
  const r = await run(HERDR, ["agent", "list"]);
  if (r.code) throw new Error("herdr agent list failed");
  return JSON.parse(r.stdout).result.agents;
}

function label(a) {
  const title = (a.terminal_title_stripped || "").trim();
  return a.name || (title && title !== "Claude Code" ? title : a.pane_id);
}

export async function fleet_status() {
  const agents = await herdrAgents();
  const rows = agents.map((a) => ({
    pane: a.pane_id,
    name: label(a),
    status: a.agent_status,
    project: basename(a.foreground_cwd || a.cwd || ""),
    commander: a.pane_id === COMMANDER,
  }));
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    taken_at: now(),
    summary: `${rows.length} agents: ${count("working")} working, ${count("idle")} idle, ${count("blocked")} blocked.`,
    agents: rows,
  };
}

export async function resolvePane(target) {
  const t = String(target || "").trim().toLowerCase();
  if (!t) throw new Error("no pane named");
  if (["commander", "the commander", "chair"].includes(t)) return COMMANDER;
  const agents = await herdrAgents();
  const exact = agents.find((a) => a.pane_id.toLowerCase() === t || (a.name || "").toLowerCase() === t);
  if (exact) return exact.pane_id;
  const loose = agents.filter((a) => label(a).toLowerCase().includes(t));
  if (loose.length === 1) return loose[0].pane_id;
  throw new Error(loose.length ? `"${target}" matches ${loose.length} panes; say which` : `no pane called "${target}"`);
}

// ---------- the queue ----------

async function queueCopy() {
  // The hub is the box. needs-you-write reads origin/master, so the hub copy is only usable
  // when it is reachable AND the Mac's master is not ahead of it (the commander can commit
  // closes on master while the box is down; origin/master would then reopen them). Otherwise
  // read master, and card_answer spools instead of writing.
  const f = await run("git", ["-C", BRAIN, "-c", "core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=5",
    "fetch", "-q", "origin", "master"], { timeout: 15_000 });
  const ahead = await run("git", ["-C", BRAIN, "rev-list", "--count", "origin/master..master"]);
  const hub = f.code === 0 && ahead.code === 0 && ahead.stdout.trim() === "0";
  const s = await run("git", ["-C", BRAIN, "show", `${hub ? "origin/master" : "master"}:queue/needs-you.json`]);
  if (s.code) throw new Error("cannot read the queue");
  return { hub, q: JSON.parse(s.stdout) };
}

const today = () => new Date().toISOString().slice(0, 10);
const parked = (i) => i.parked?.until && String(i.parked.until) >= today();
const RISKY = /public|publish|push|merge|deploy|spend|pay|price|stripe|secret|key|token|delet|send|mail|outreach|real data|client|legal/i;

export function isRisky(card) {
  return Number(card.tier) >= 3 || RISKY.test(`${card.title} ${card.ask} ${card.why} ${card.default} ${(card.options || []).join(" ")}`);
}

export function mapWord(card, spoken) {
  const w = String(spoken || "").trim().toLowerCase();
  const opts = (card.options || []).map((o) => String(o).toLowerCase());
  if (opts.includes(w) || w === "later") return w;
  if (["hold", "wait", "not now"].includes(w)) return opts.includes("hold") ? "hold" : "later";
  if (["approve", "yes", "go", "do it", "ok"].includes(w)) {
    const yes = opts.filter((o) => o !== "hold" && o !== "later");
    if (yes.length === 1) return yes[0];
  }
  return null;
}

export async function cards_list() {
  const { hub, q } = await queueCopy();
  const open = q.items.filter((i) => !i.done && !parked(i));
  open.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || String(a.since).localeCompare(String(b.since)));
  return {
    source: hub ? "the hub" : "the local vault copy (the box is unreachable, so this may be behind)",
    open: open.length,
    cards: open.map((i) => ({
      id: i.id,
      ask: redact(clip(i.ask || i.title, 220)),
      why: redact(clip(i.why, 220)),
      options: i.options,
      if_nobody_answers: redact(clip(i.default, 140)),
      tier: i.tier,
      needs_confirm: isRisky(i),
      owner: i.agent || i.owner,
    })),
  };
}

// A spoken "confirm" is proven by Karl's own transcribed words, not by a flag the model sets:
// the page posts every final user transcript here, and a risky answer is recorded only when one
// of them says confirm AFTER the bridge issued the echo for that exact card and word.
const heard = new Map();    // callId -> [{at, text}]
const echoes = new Map();   // `${callId}|${id}|${answer}` -> issued at (ms)
const CONFIRM = /\b(confirm(ed)?|best(ä|ae)tig\w*|подтвер\w*)\b/i;

export function hearUser(callId, text) {
  if (!callId || !text) return;
  const list = heard.get(callId) || [];
  list.push({ at: Date.now(), text: String(text).slice(0, 500) });
  heard.set(callId, list.slice(-50));
}

function confirmedSince(callId, since) {
  return (heard.get(callId) || []).some((h) => h.at > since && CONFIRM.test(h.text));
}

async function commander(text, ctx) {
  try { return (await tell({ pane: "commander", text }, ctx)).sent === true; } catch { return false; }
}

export async function card_answer({ id, word, note = "", excerpt = "" }, ctx = {}) {
  const { hub, q } = await queueCopy();
  const card = q.items.find((i) => i.id === id);
  if (!card) return { recorded: false, reason: `no card with id ${id}` };
  if (card.done) return { recorded: false, reason: `already closed (${card.answer || "no word"})` };
  const spoken = String(word || "").toLowerCase();
  if (spoken === "change") {
    const sent = await commander(`[voice ${now()}] Karl wants a CHANGE on card ${id}: ${note || excerpt}`, ctx);
    logEvent(ctx, { type: "card_change", id, note, sent });
    return { recorded: false, say: sent ? "Sent the change to the commander; the card stays open." : "I could not reach the commander; the card stays open." };
  }
  const answer = mapWord(card, spoken);
  if (!answer) return { recorded: false, reason: `say one of: ${(card.options || []).join(", ")}, later, or change` };
  const key = `${ctx.callId}|${id}|${answer}`;
  if (isRisky(card) && answer !== "hold" && answer !== "later") {
    const issued = echoes.get(key);
    if (!issued || !confirmedSince(ctx.callId, issued)) {
      if (!issued) echoes.set(key, Date.now());
      return { recorded: false, needs_confirm: true,
        say: `Echo this in one sentence: ${card.tier >= 3 ? "tier " + card.tier : "sensitive"}, ${redact(clip(card.ask || card.title, 160))}, answer "${answer}". Ask Karl to say "confirm", then call card_answer again with the same id and word.` };
    }
    echoes.delete(key);
  }
  const quote = redact(clip(excerpt || word, 160)).replace(/["\n]/g, " ");
  const by = `karl by voice, source=voice, call ${ctx.callId || "?"} at ${now()}: "${quote}"${note ? " · note: " + redact(clip(note, 200)) : ""}`;
  const op = { id, answer, by };
  if (!hub) return spool(op, ctx, "the hub is unreachable or behind the Mac's vault");
  const r = await run(NYW, ["--message", `voice: ${id} = ${answer}`], { input: JSON.stringify([op]), timeout: 75_000 });
  logEvent(ctx, { type: "card_answer", id, answer, code: r.code });
  if (r.code === 0 || r.code === 3) {
    const sent = await commander(`[voice ${now()}] Karl answered card ${id} = ${answer} by voice (recorded on the hub). Execute it.${note ? " Note: " + note : ""}`, ctx);
    return { recorded: true, answer, say: sent ? `Recorded: ${answer}. The commander has it.` : `Recorded: ${answer}, but I could not reach the commander.` };
  }
  if (r.code === 2) return { recorded: false, reason: redact(clip(r.stdout + r.stderr, 300)) };
  if (r.code === 1 && /not recorded|push|fetch|ssh|connect/i.test(r.stdout + r.stderr)) return spool(op, ctx, "the push to the hub failed");
  return { recorded: false, reason: `the queue tool failed (exit ${r.code}); nothing recorded, nothing spooled` };
}

async function spool(op, ctx, why) {
  appendFileSync(SPOOL, JSON.stringify({ at: now(), op, call: ctx.callId }) + "\n", { mode: 0o600 });
  logEvent(ctx, { type: "card_answer", id: op.id, answer: op.answer, spooled: true });
  const sent = await commander(`[voice ${now()}] Karl answered card ${op.id} = ${op.answer} by voice. Not on the hub (${why}): SPOOLED in ${SPOOL}. After you push the vault's master to origin, run voice/bin/replay-answers.`, ctx);
  return { recorded: "spooled", answer: op.answer, say: `Kept locally, because ${why}; it goes into the queue once the commander has pushed the vault.${sent ? "" : " I could not reach the commander."}` };
}

export async function replaySpool() {
  if (!existsSync(SPOOL)) return { replayed: 0, left: 0 };
  const { hub } = await queueCopy();
  if (!hub) return { replayed: 0, refused: "the hub is unreachable, or the vault's master is ahead of origin: the commander pushes master first" };
  // Move the spool aside first, so an answer spooled during the replay is never overwritten.
  const work = SPOOL + `.replaying-${process.pid}`;
  renameSync(SPOOL, work);
  const left = [];
  let replayed = 0;
  for (const l of readFileSync(work, "utf8").split("\n").filter(Boolean)) {
    const { op } = JSON.parse(l);
    const r = await run(NYW, ["--message", `voice (replayed): ${op.id} = ${op.answer}`], { input: JSON.stringify([op]), timeout: 75_000 });
    if (r.code === 0 || r.code === 3 || r.code === 2) replayed++; // 2 = refused, e.g. already closed: nothing to keep
    else left.push(l);
  }
  if (left.length) appendFileSync(SPOOL, left.map((l) => l + "\n").join(""), { mode: 0o600 });
  unlinkSync(work);
  return { replayed, left: left.length };
}

// ---------- panes ----------

export async function tell({ pane, text }, ctx = {}) {
  const target = await resolvePane(pane);
  const body = String(text || "").slice(0, 2000);
  if (!body.trim()) return { sent: false, reason: "nothing to send" };
  const r = await run(HERDR, ["agent", "prompt", target, body], { timeout: 15_000 });
  logEvent(ctx, { type: "tell", pane: target, code: r.code });
  if (r.code) return { sent: false, reason: redact(clip(r.stdout + r.stderr, 200)) };
  return { sent: true, pane: target };
}

const pendingAsks = new Map(); // callId -> [{pane, question, answer}]

export async function ask({ pane, question }, ctx = {}) {
  const target = await resolvePane(pane);
  const r = await run(HERDR, ["agent", "prompt", target,
    `${String(question).slice(0, 1500)}\n\n(Asked by Karl on a voice call. Answer in at most three plain sentences, no code, no secrets; the answer is read aloud.)`],
  { timeout: 15_000 });
  if (r.code) return { asked: false, reason: redact(clip(r.stdout + r.stderr, 200)) };
  logEvent(ctx, { type: "ask", pane: target });
  // Never block the conversation: wait in the background, hand the answer to the page later.
  (async () => {
    await run(HERDR, ["agent", "wait", target, "--until", "working", "--timeout", "8000"], { timeout: 10_000 });
    await run(HERDR, ["agent", "wait", target, "--timeout", String(15 * 60_000)], { timeout: 15 * 60_000 + 5000 });
    const out = await run(HERDR, ["agent", "read", target, "--source", "recent-unwrapped", "--lines", "40"]);
    const answer = redact(clip(tailAnswer(out.stdout), 1200));
    const list = pendingAsks.get(ctx.callId) || [];
    list.push({ pane: target, question, answer, at: now() });
    pendingAsks.set(ctx.callId, list);
  })().catch(() => {});
  return { asked: true, pane: target, say: "Asked. I'll tell you when the answer is in." };
}

function tailAnswer(screen) {
  // The last Claude Code reply block: lines after the last "⏺" marker, without the input box.
  const lines = String(screen).split("\n");
  let start = 0;
  lines.forEach((l, i) => { if (l.trimStart().startsWith("⏺")) start = i; });
  return lines.slice(start).filter((l) => !/^[\s─│╭╮╰╯>]*$/.test(l) && !/bypass|shift\+tab|esc to/i.test(l)).join("\n").trim();
}

export function takeAnswers(callId) {
  const list = pendingAsks.get(callId) || [];
  pendingAsks.delete(callId);
  return list;
}

export async function spawn_lane({ goal }, ctx = {}) {
  const r = await tell({ pane: "commander", text: `[voice ${now()}] Karl asks for a NEW LANE. Goal: ${String(goal).slice(0, 1500)}\nSpawn it if it fits the plan; say on the call (via the voice lane) if not.` }, ctx);
  return r.sent ? { routed: "commander", say: "The commander has the lane request." } : r;
}

// ---------- box and goals ----------

export async function box_health() {
  const t0 = Date.now();
  const r = await run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "dgx-remote",
    "uptime; systemctl --user is-active hermes-serve lucky-loop.timer 2>/dev/null; df -h / | tail -1"], { timeout: 12_000 });
  if (r.code) return { reachable: false, say: "The box is unreachable from this Mac right now.", checked_at: now() };
  return { reachable: true, rtt_ms: Date.now() - t0, report: redact(clip(r.stdout, 600)), checked_at: now() };
}

export async function okr_status() {
  const okrs = JSON.parse(readFileSync(join(REPO, "data/okrs.json"), "utf8"));
  const objs = okrs.objectives || okrs.okrs || okrs;
  const out = (Array.isArray(objs) ? objs : []).map((o) => ({
    objective: o.title || o.objective || o.id,
    due: o.due ?? null,
    met_on: o.metOn ?? null,
    key_results: (o.keyResults || o.krs || o.key_results || []).map((k) => ({
      kr: clip(k.title || k.name || k.id, 140),
      progress: k.progress ?? k.value ?? null,
      target: k.target ?? null,
    })),
  }));
  return { source: "data/okrs.json in the main checkout", objectives: out };
}

// ---------- the call log ----------

export function callDir(callId) {
  const d = join(STATE, "calls", String(callId).replace(/[^A-Za-z0-9_-]/g, "_"));
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

export function logEvent(ctx, ev) {
  if (!ctx.callId) return;
  appendFileSync(join(callDir(ctx.callId), "events.jsonl"), JSON.stringify({ t: now(), ...ev }) + "\n", { mode: 0o600 });
}

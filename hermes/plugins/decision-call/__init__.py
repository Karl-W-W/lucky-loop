"""decision-call — the call where Karl hears one card, talks through its effects, and gives his word.

Command Center slice 3 (Karl, 2026-09-27: "leave all essential decisions to me once the Hermes
desktop app can display the decision cards and make a call with me to discuss their effects").

THREE TOOLS, AND THE PROFILE THAT LOADS THIS PLUGIN HAS NO OTHER WRITE:

  call_card(id?)          read one open card from the hub's copy of queue/needs-you.json
                          (no id: the next open, un-parked card in the queue's order)
  call_readback(id, word) the word Karl said, checked against that card's options; returns the
                          sentence the agent must say back to him. Writes nothing.
  call_record(id, word)   records the word through the vault's one writer
                          (~/brain/tools/needs-you-write, the one `decide` uses) with
                          doneBy "karl — call <word>" — but ONLY when all of these hold:

    1. a readback of this exact (card, word) was made in THIS session, in an EARLIER turn,
       less than 10 minutes ago, and has not been spent. A turn only starts when Karl sends a
       message, so "earlier turn" means a human spoke after the readback. (The same rule
       feed-gate.py enforces for `feed:loop --yes`, learned when a bot ran check-then-publish
       inside one turn.)
    2. Karl's newest message in this session — read from the session store, not from the
       model — is an explicit yes ("yes", "yes, record it", "confirm", …) and arrived after the
       readback. Anything else ("no", "wait", "hold on", "yes but…") refuses. This closes the gap
       feed-gate.py names: a new turn proves a human spoke, the store shows WHAT he said.
    3. Tier 3 takes a second yes: the first call_record after the yes writes nothing and asks
       for a confirm naming the card's title and the word (A7's second click, spoken); only a
       call_record in a later turn, after another explicit yes, hands it to the writer.

The model cannot supply the turn id or the reply: the turn id reaches the handler through this
plugin's own pre_tool_call hook (Hermes hands hooks the turn id, not tools), and the reply is
read from state.db by session id. If either is missing the tool refuses — it fails closed.
Hook exceptions in Hermes fail OPEN, so the hook only notes the turn; every check lives in
the handler.

What this never does: run a shell for the model, send a message to anyone, push code, spend
money, take a value (A4: a PASTE card is answered with the word `pasted`, never the value),
or answer more than one card per record call (A2: Karl says each word for each card).

Every record attempt is logged (time, card, word, verdict — never text) to
~/.local/state/lucky-loop/decision-call/log.jsonl on this machine, never in the vault.

``python3 __init__.py --selftest`` runs the gate against a temp queue, a temp session store and
a fake writer.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

REPO = Path(os.environ.get("DECISION_CALL_REPO") or Path.home() / "brain")
WRITER = Path(os.environ.get("DECISION_CALL_WRITER") or REPO / "tools" / "needs-you-write")
REMOTE, BRANCH, QPATH = "origin", "master", "queue/needs-you.json"
STATE = Path(os.environ.get("DECISION_CALL_STATE") or Path.home() / ".local/state/lucky-loop/decision-call")
READBACK_TTL = 10 * 60
# The surface names who carried the word: "call" (the Desktop call, the default) or "whatsapp" (the
# staged WhatsApp switch). Nothing else: doneBy is read by the verifier and must stay a closed set.
SURFACE = os.environ.get("DECISION_CALL_SURFACE", "call")
if SURFACE not in ("call", "whatsapp"):
    SURFACE = "call"
DONE_BY = f"karl — {SURFACE}"
WORD = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
TOOLS = ("call_card", "call_readback", "call_record")

# An explicit yes, and nothing that hedges it. Voice transcripts arrive as "Yes." or
# "Yes, record it." — both pass. "yes but wait", "no", "hold on", "ok" do not.
_YES_HEAD = r"(?:yes|yeah|yep|ja|confirm|confirmed|correct)"
_YES_TAIL = r"(?:please|record it|do it|go ahead|confirm|confirmed|that'?s right|record|that one)"
YES = re.compile(rf"^{_YES_HEAD}(?:[\s,.!-]+{_YES_TAIL})*[\s.!]*$", re.I)

_lock = threading.Lock()
_turns: Dict[str, str] = {}  # session id -> the turn id the hook saw last for one of our tools


# ------------------------------------------------------------------ the queue (hub copy)

def _git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True,
                          check=True, timeout=60).stdout


def hub_queue() -> Dict[str, Any]:
    """The hub's copy, never the working tree's (the writer reads the same)."""
    subprocess.run(["git", "-C", str(REPO), "fetch", "-q", REMOTE, BRANCH], capture_output=True, timeout=60)
    return json.loads(_git("show", f"refs/remotes/{REMOTE}/{BRANCH}:{QPATH}"))


def _num(v: Any, default: int = 99) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _tier(card: Dict[str, Any]) -> Optional[int]:
    t = card.get("tier")
    return _num(t, 0) or None


def _parked(card: Dict[str, Any], today: str) -> bool:
    p = card.get("parked") or {}
    return bool(p.get("until")) and str(p["until"]) >= today


def queue_order(items: List[Dict[str, Any]], today: Optional[str] = None) -> List[Dict[str, Any]]:
    """Open, un-parked cards in the queue's order: priority, expiry, age, id (the tray's byQueue)."""
    today = today or datetime.date.today().isoformat()
    live = [i for i in items if not i.get("done") and not _parked(i, today)]
    return sorted(live, key=lambda i: (_num(i.get("priority")), str(i.get("expiry") or "9999"),
                                       str(i.get("since") or ""), str(i.get("id"))))


def words_of(card: Dict[str, Any]) -> List[str]:
    return [str(o).lower() for o in (card.get("options") or []) if WORD.match(str(o).lower())] + ["later"]


def card_view(card: Dict[str, Any], position: Optional[int] = None, of: Optional[int] = None) -> Dict[str, Any]:
    keys = ("id", "title", "ask", "ask_kind", "tier", "options", "default", "why", "steps", "check",
            "command", "expiry", "since", "agent", "owner", "closes_by", "parked")
    v = {k: card.get(k) for k in keys if card.get(k) not in (None, "", [])}
    v["words"] = words_of(card)
    if position is not None:
        v["position"] = f"{position} of {of}"
    return v


# ------------------------------------------------------------------ what Karl said (session store)

def _state_db() -> Path:
    home = os.environ.get("HERMES_HOME")
    if not home:
        try:
            from hermes_constants import get_hermes_home  # type: ignore
            home = str(get_hermes_home())
        except Exception:
            home = str(Path.home() / ".hermes")
    return Path(home) / "state.db"


def last_user_message(session_id: str, db: Optional[Path] = None) -> Optional[Tuple[str, float]]:
    """(text, timestamp) of the newest user message in this session, or None."""
    path = db or _state_db()
    if not session_id or not path.exists():
        return None
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    try:
        row = con.execute("SELECT content, timestamp FROM messages WHERE session_id = ? AND role = 'user' "
                          "ORDER BY id DESC LIMIT 1", (session_id,)).fetchone()
    finally:
        con.close()
    if not row:
        return None
    text = row[0]
    if isinstance(text, str) and text.startswith("["):
        try:  # multimodal content: the text parts
            text = " ".join(p.get("text", "") for p in json.loads(text) if isinstance(p, dict))
        except ValueError:
            pass
    return (str(text or ""), float(row[1] or 0))


def is_explicit_yes(text: str) -> bool:
    return bool(YES.match((text or "").strip()))


# ------------------------------------------------------------------ the ledger and the log

def _ledger_path() -> Path:
    return STATE / "readbacks.jsonl"


def _read_ledger(now: float) -> List[Dict[str, Any]]:
    rows = []
    try:
        for line in _ledger_path().read_text().splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if now - r.get("t", 0) < READBACK_TTL:
                rows.append(r)
    except FileNotFoundError:
        pass
    return rows


def _write_ledger(rows: List[Dict[str, Any]]) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = _ledger_path().with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
    os.replace(tmp, _ledger_path())


def log(verdict: str, cid: Optional[str], word: Optional[str], session: str, detail: str = "") -> None:
    try:
        STATE.mkdir(parents=True, exist_ok=True)
        with open(STATE / "log.jsonl", "a") as f:
            f.write(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                                "surface": "call", "session": session, "card": cid, "word": word,
                                "verdict": verdict, "detail": detail[:200]}) + "\n")
    except OSError:
        pass


# ------------------------------------------------------------------ the writer

def run_writer(cid: str, word: str) -> Tuple[int, str]:
    op = {"id": cid, "answer": word}
    if word != "later":
        op["by"] = f"{DONE_BY} {word}"
    env = dict(os.environ, NYW_REPO=str(REPO))
    cmd = ([sys.executable, str(WRITER)] if WRITER.suffix == ".py" else [str(WRITER)]) + ["--message", f"{SURFACE}: {cid} = {word}"]
    try:
        r = subprocess.run(cmd, input=json.dumps([op]), capture_output=True, text=True, env=env, timeout=120)
    except subprocess.TimeoutExpired:
        return -9, "the writer ran past 120 s and was stopped — the push may or may not have landed; check the queue"
    except OSError as e:
        return 1, f"the writer could not start: {type(e).__name__}"
    return r.returncode, (r.stdout + r.stderr).strip()[-600:]


# ------------------------------------------------------------------ the tools

def _j(obj: Dict[str, Any]) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _find(cid: str, items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return next((i for i in items if i.get("id") == cid), None)


def _check(cid: Any, word: Any, items: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], str, Optional[str]]:
    """(card, clean word, refusal)."""
    if not isinstance(cid, str) or not cid.strip():
        return None, "", "name the card by its full id"
    card = _find(cid.strip(), items)
    if card is None:
        return None, "", f"no card with the id {cid!r} (ids are full ids, never numbers)"
    if card.get("done"):
        return None, "", f"{cid} is already done ({card.get('answer') or 'no word'}, {card.get('doneOn', '?')}); only Karl reopens a card"
    w = str(word or "").strip().lower()
    if w not in words_of(card):
        return None, "", f"'{w}' is not one of this card's words: {', '.join(words_of(card))}"
    return card, w, None


def call_card(args: Dict[str, Any], queue: Optional[Callable[[], Dict[str, Any]]] = None, **_: Any) -> str:
    items = (queue or hub_queue)().get("items", [])
    order = queue_order(items)
    cid = (args or {}).get("id")
    if cid:
        card = _find(str(cid).strip(), items)
        if card is None:
            return _j({"error": f"no card with the id {cid!r}"})
        if card.get("done"):
            return _j({"error": f"{cid} is already done ({card.get('answer')})", "card": card_view(card)})
        pos = next((n for n, c in enumerate(order, 1) if c.get("id") == card.get("id")), None)
        return _j({"card": card_view(card, pos, len(order)), "open_cards": len(order)})
    if not order:
        return _j({"card": None, "open_cards": 0, "say": "Nothing needs you right now."})
    return _j({"card": card_view(order[0], 1, len(order)), "open_cards": len(order),
               "next": [c.get("id") for c in order[1:4]]})


def call_readback(args: Dict[str, Any], session_id: str = "", queue: Optional[Callable[[], Dict[str, Any]]] = None,
                  now: Optional[float] = None, **_: Any) -> str:
    now = now or time.time()
    turn = _turns.get(session_id or "")
    if not session_id or not turn:
        return _j({"error": "refused — this call has no session or turn id, so a readback cannot be tied to Karl's reply"})
    card, w, why = _check((args or {}).get("id"), (args or {}).get("word"), (queue or hub_queue)().get("items", []))
    if why:
        return _j({"error": "refused — " + why})
    with _lock:
        rows = [r for r in _read_ledger(now) if not (r["session"] == session_id and r["id"] == card["id"])]
        rows.append({"t": now, "session": session_id, "turn": turn, "id": card["id"], "word": w, "stage": "word"})
        _write_ledger(rows)
    title = card.get("ask") or card.get("title") or card["id"]
    say = f"I heard “{w}” for “{title}”. Shall I record {w}? Say yes to record it, or tell me another word."
    if w == "later":
        say = f"I heard “later” for “{title}”: that parks it until tomorrow and it stays open. Shall I park it? Say yes."
    return _j({"ok": True, "say": say, "tier": _tier(card),
               "rule": "Say this sentence to Karl and STOP. Record only after his next message is an explicit yes."})


def call_record(args: Dict[str, Any], session_id: str = "", queue: Optional[Callable[[], Dict[str, Any]]] = None,
                writer: Callable[[str, str], Tuple[int, str]] = run_writer, db: Optional[Path] = None,
                now: Optional[float] = None, **_: Any) -> str:
    now = now or time.time()
    sid = session_id or ""
    turn = _turns.get(sid)
    cid, word = (args or {}).get("id"), (args or {}).get("word")

    def refuse(msg: str) -> str:
        log("refused", cid if isinstance(cid, str) else None, str(word or "")[:40], sid, msg)
        return _j({"error": "refused — " + msg + ". Nothing was written."})

    if not sid or not turn:
        return refuse("this call has no session or turn id, so Karl's reply cannot be checked")
    card, w, why = _check(cid, word, (queue or hub_queue)().get("items", []))
    if why:
        return refuse(why)
    with _lock:
        rows = _read_ledger(now)
        mine = [r for r in rows if r["session"] == sid and r["id"] == card["id"]]
        rb = mine[-1] if mine else None
        if rb is None or rb["word"] != w:
            return refuse(f"there is no readback of '{w}' for this card in this call — call call_readback, say it, and wait for Karl")
        if rb["turn"] == turn:
            return refuse("the readback was made in THIS turn; Karl has not answered it yet. Say the readback and stop")
        said = last_user_message(sid, db)
        if said is None:
            return refuse("Karl's reply could not be read from the session store")
        text, at = said
        if at < rb["t"] - 1:
            return refuse("Karl has not sent a message since the readback")
        if not is_explicit_yes(text):
            return refuse("Karl's last message is not an explicit yes. Ask again, or take the new word he gave")
        tier3 = _tier(card) == 3 and w != "later"
        if tier3 and rb["stage"] == "word":
            rows = [r for r in rows if r is not rb] + [{**rb, "t": now, "turn": turn, "stage": "confirm"}]
            _write_ledger(rows)
            log("confirm-asked", card["id"], w, sid, "tier 3: nothing written until a second yes")
            return _j({"ok": False, "verdict": "confirm", "say":
                       f"This is a tier-3 card: “{card.get('title', card['id'])}”. "
                       f"Recording “{w}” closes it for good. Say yes once more to record {w}.",
                       "rule": "Say this and STOP. Nothing was written."})
        _write_ledger([r for r in rows if r is not rb])  # spent before the write: one yes, one record
    rc, out = writer(card["id"], w)
    verdict = {0: "recorded", 3: "recorded-box-behind", 2: "refused-by-writer", -9: "outcome-unknown"}.get(rc, "not-recorded")
    log(verdict, card["id"], w, sid, f"writer rc {rc}")
    return _j({"ok": rc in (0, 3), "verdict": verdict, "writer_rc": rc, "writer": out,
               "say": (f"Recorded “{w}” on {card['id']}." if rc in (0, 3)
                       else "The outcome is unknown: the writer was stopped mid-push. Check the queue before saying the word again." if rc == -9
                       else f"Not recorded ({verdict}). Nothing changed on the card.")})


def _on_pre_tool_call(tool_name: str = "", args: Any = None, session_id: str = "", turn_id: str = "", **_: Any) -> None:
    """Note the turn for our own tools. Never blocks (hook errors fail open in Hermes; the handler fails closed)."""
    try:
        if tool_name in TOOLS and session_id:
            _turns[session_id] = str(turn_id or "")
    except Exception:
        pass
    return None


# ------------------------------------------------------------------ registration

_ID = {"type": "string", "description": "the card's full id, exactly as call_card returned it"}
_W = {"type": "string", "description": "the ONE word Karl said, one of the card's `words`"}
SCHEMAS = {
    "call_card": {"name": "call_card", "description":
                  "Read one open decision card from the hub's queue (read-only). With no id: the next open card in "
                  "the queue's order. Returns its title, ask, tier, words, default, why, steps and check.",
                  "parameters": {"type": "object", "properties": {"id": _ID}, "required": []}},
    "call_readback": {"name": "call_readback", "description":
                      "Karl said a word for a card: check it against the card's words and get the sentence to say back. "
                      "Writes nothing. Say the returned sentence and stop; wait for his next message.",
                      "parameters": {"type": "object", "properties": {"id": _ID, "word": _W}, "required": ["id", "word"]}},
    "call_record": {"name": "call_record", "description":
                    "Record Karl's word on the card — ONLY after you read it back with call_readback and his NEXT message "
                    "was an explicit yes. Refuses otherwise. Tier 3 asks for one more yes first.",
                    "parameters": {"type": "object", "properties": {"id": _ID, "word": _W}, "required": ["id", "word"]}},
}


def register(ctx) -> None:
    handlers = {"call_card": call_card, "call_readback": call_readback, "call_record": call_record}
    emoji = {"call_card": "🗂️", "call_readback": "🔁", "call_record": "✅"}
    for name in TOOLS:
        ctx.register_tool(name=name, toolset="decision_call", schema=SCHEMAS[name], handler=handlers[name],
                          emoji=emoji[name])
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)


# ------------------------------------------------------------------ selftest

def selftest() -> int:
    import tempfile
    global STATE
    fails = 0

    def ok(cond: bool, name: str) -> None:
        nonlocal fails
        print(("ok   " if cond else "FAIL ") + name)
        fails += 0 if cond else 1

    with tempfile.TemporaryDirectory() as td:
        STATE = Path(td) / "state"
        db = Path(td) / "state.db"
        con = sqlite3.connect(db)
        con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
        con.commit()

        def say(text: str, t: float) -> None:
            con.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES ('S', 'user', ?, ?)", (text, t))
            con.commit()

        items = [
            {"id": "one-2026-01-01", "title": "Retry the job", "tier": 1, "options": ["hold", "done"], "priority": 2},
            {"id": "three-2026-01-01", "title": "Merge the branch", "tier": "3", "options": ["hold", "merge"], "priority": 1},
            {"id": "gone-2026-01-01", "title": "Old", "tier": 1, "options": ["done"], "done": True, "answer": "done"},
        ]
        Q = lambda: {"items": items}  # noqa: E731
        calls: List[Tuple[str, str]] = []

        def W(cid: str, w: str) -> Tuple[int, str]:
            calls.append((cid, w))
            return 0, "recorded abc1234"

        T = 1_000_000.0
        c = json.loads(call_card({}, queue=Q))
        ok(c["card"]["id"] == "three-2026-01-01" and c["open_cards"] == 2, "call_card: next card in the queue's order")
        ok(c["card"]["words"] == ["hold", "merge", "later"], "call_card: the card's words plus later")

        _turns["S"] = "t1"
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "done"}, session_id="S", queue=Q, writer=W, db=db, now=T))
        ok("error" in r and not calls, "record with no readback: refused, nothing written")
        r = json.loads(call_readback({"id": "one-2026-01-01", "word": "go"}, session_id="S", queue=Q, now=T))
        ok("error" in r, "readback of an off-list word: refused")
        r = json.loads(call_readback({"id": "gone-2026-01-01", "word": "done"}, session_id="S", queue=Q, now=T))
        ok("error" in r, "readback on a done card: refused")
        r = json.loads(call_readback({"id": "one-2026-01-01", "word": "done"}, session_id="S", queue=Q, now=T))
        ok(r.get("ok") and "done" in r["say"], "readback: the sentence names the word")
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "done"}, session_id="S", queue=Q, writer=W, db=db, now=T + 1))
        ok("error" in r and "THIS turn" in r["error"] and not calls, "record in the readback's own turn: refused")
        _turns["S"] = "t2"
        say("no, wait", T + 5)
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "done"}, session_id="S", queue=Q, writer=W, db=db, now=T + 6))
        ok("error" in r and "explicit yes" in r["error"] and not calls, "a later turn that is not a yes: refused")
        say("yes but maybe hold", T + 7)
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "done"}, session_id="S", queue=Q, writer=W, db=db, now=T + 8))
        ok("error" in r and not calls, "a hedged yes: refused")
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "hold"}, session_id="S", queue=Q, writer=W, db=db, now=T + 8))
        ok("error" in r and not calls, "record of a different word than the readback: refused")
        say("Yes, record it.", T + 9)
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "done"}, session_id="S", queue=Q, writer=W, db=db, now=T + 10))
        ok(r.get("ok") and calls == [("one-2026-01-01", "done")], "an explicit yes in a later turn: handed to the writer once")
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "done"}, session_id="S", queue=Q, writer=W, db=db, now=T + 11))
        ok("error" in r and len(calls) == 1, "the yes is spent: a second record is refused")

        # tier 3: yes -> confirm (nothing written) -> yes in a later turn -> written
        _turns["S"] = "t3"
        json.loads(call_readback({"id": "three-2026-01-01", "word": "merge"}, session_id="S", queue=Q, now=T + 20))
        _turns["S"] = "t4"
        say("yes", T + 25)
        r = json.loads(call_record({"id": "three-2026-01-01", "word": "merge"}, session_id="S", queue=Q, writer=W, db=db, now=T + 26))
        ok(r.get("verdict") == "confirm" and "Merge the branch" in r["say"] and len(calls) == 1, "tier 3 first yes: confirm, nothing written")
        r = json.loads(call_record({"id": "three-2026-01-01", "word": "merge"}, session_id="S", queue=Q, writer=W, db=db, now=T + 27))
        ok("error" in r and len(calls) == 1, "tier 3 confirm in the same turn: refused")
        _turns["S"] = "t5"
        say("confirm", T + 30)
        r = json.loads(call_record({"id": "three-2026-01-01", "word": "merge"}, session_id="S", queue=Q, writer=W, db=db, now=T + 31))
        ok(r.get("ok") and calls[-1] == ("three-2026-01-01", "merge"), "tier 3 second yes in a later turn: written")

        # another session cannot spend this session's readback; no turn id fails closed
        _turns["S"] = "t6"
        json.loads(call_readback({"id": "one-2026-01-01", "word": "hold"}, session_id="S", queue=Q, now=T + 40))
        _turns["X"] = "x1"
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "hold"}, session_id="X", queue=Q, writer=W, db=db, now=T + 45))
        ok("error" in r and len(calls) == 2, "another session's record: refused")
        _turns.pop("S")
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "hold"}, session_id="S", queue=Q, writer=W, db=db, now=T + 46))
        ok("error" in r and len(calls) == 2, "no turn id from the hook: refused (fails closed)")
        # a stale readback expires
        _turns["S"] = "t7"
        say("yes", T + 40 + READBACK_TTL + 5)
        r = json.loads(call_record({"id": "one-2026-01-01", "word": "hold"}, session_id="S", queue=Q, writer=W, db=db, now=T + 40 + READBACK_TTL + 6))
        ok("error" in r and len(calls) == 2, "a readback older than 10 minutes: refused")

        for t, want in [("yes", True), ("Yes.", True), ("yes, record it", True), ("Confirm", True), ("ja", True),
                        ("no", False), ("ok", False), ("yes but no", False), ("yes hold", False), ("", False)]:
            ok(is_explicit_yes(t) is want, f"yes-matcher: {t!r} -> {want}")
        logged = (STATE / "log.jsonl").read_text()
        ok("Yes, record it" not in logged and '"verdict": "recorded"' in logged, "the log holds verdicts, never Karl's text")
        con.close()
    print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failing")
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)

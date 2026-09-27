"""Answer — verb (a): Karl's own word on ONE open needs-you card, sent from the page.

Mounted under ``/api/plugins/fleet/`` by ``plugin_api.py`` beside ``today_api.py``.

THE ONE EXCEPTION TO READ-ONLY, AND IT SHIPS OFF. The Today page reports; it does
not control (the 09-03 ruling). The council of 2026-09-22 allowed exactly one verb,
carrying its A7 sentence:

    Only Karl's click on that card's own button sends an answer: one card per
    click, and a tier-3 word only after a second click that shows the card's
    title and the word. The route takes an open card id and one word from that
    card's ``options``, or ``later``, and nothing else. It logs time, card and
    word; the verifier reads that log at clock-out.

How that is held here, as code:

* **Off by default, twice.** The server answers 404 unless the flag file holds
  ``on`` (``~/.config/lucky-loop/fleet-answer-verb``; read on every request, so
  switching it needs no restart). The page shows no send button unless its own
  constant ``ANSWER_ON_PAGE`` is true AND this server says ``enabled``.
* **One card, one word, nothing else.** The body is a closed set of keys; no free
  text crosses. The word must be one of that card's own ``options`` or ``later``.
  Unknown ids, done ids and off-list words are refused before the writer runs.
* **A token scoped to exactly this write.** ``offer()`` signs ``id|word|exp`` with
  a key that lives only in this process's memory (new at every restart, never on
  disk); the POST must carry the signature for that card and that word, within 15
  minutes. A used token is refused on replay.
* **Tier 3 takes a second click, enforced here.** The first POST on a tier-3 card
  writes nothing and returns a confirm token (90 s) with the title and the word;
  only a second POST carrying it is handed on.
* **No new write path.** The answer goes through the vault's existing writer,
  ``~/brain/tools/needs-you-write`` (the one ``decide`` uses): it reads the hub's
  copy, refuses unknown/done ids and off-list words again, commits through a
  temporary index and pushes. It records ``doneBy: "karl — page <word>"``.
* **Only the page's channel may answer (slice 3, 2026-09-27).** Every POST must carry
  the header ``X-Fleet-Answer-Key``: a random secret that exists ONLY on the Mac —
  in ``~/.config/lucky-loop/fleet-answer-channel.key`` (mode 600) and in the Hermes
  Desktop's per-connection remote headers (``connections.json`` / ``connection.json``
  under ``~/Library/Application Support/Hermes``), which the Desktop's main process
  attaches to every request it sends to this box (``headersForRemoteRequest`` in the
  vendor's ``fetchJson``, the path ``ctx.rest`` takes). This box holds only
  ``sha256(secret)`` in ``~/.config/lucky-loop/fleet-answer-channel.sha256`` (mode
  600, refused if group/other can read or write it). The check hashes what arrived
  and compares in constant time. Missing, wrong, or no verifier on file: 403, logged,
  nothing written. Only then is doneBy written as ``karl — page <word>``.
* **Every call is logged** (when, card, word, surface=page, verdict, client address,
  whether the page key matched — never its value — and Origin and User-Agent as sent)
  to ``~/.local/state/lucky-loop/page-answer/log.jsonl`` on this box — never in the
  vault, never a token. ``who`` is never written as "karl": the server cannot know
  who clicked, only that the request carried the Mac's key.

WHY A BOX PROCESS CANNOT FORGE THE KEY, AND WHAT IT STILL CAN DO, said plainly:

* The session token (in ``~/.hermes/.env``, readable by any process of this user)
  still gates the dashboard as a whole, but no longer gates answers: a box process
  holding it gets 403 without the key. The box stores a SHA-256 of a 256-bit random
  value, which checks a key but cannot produce one. The key never lands in a box
  file or log: this module logs a match verdict only, and hermes-serve logs no
  request headers. Rotate both sides with ``hermes/tools/answer-channel-rotate``.
* The Origin allow-list of slice 2 is REMOVED: an Origin is the sender's own claim,
  and the Desktop's main process sends none, so it could only ever refuse Karl. The
  Origin is still logged as claimed.
* Not closed, and not closable from inside this process: a box process of the same
  user can rewrite this file (or the vault writer's input) and restart the server.
  The key moves the forgery from "one curl with a token" to "edit and restart the
  server", which the ledger of deploys and ``git status`` on the box would show.
  Reading the key in flight would need ptrace of sshd or hermes-serve (Yama
  ``ptrace_scope`` is 1 on this box) or root. Any process on the MAC that can read
  Karl's files can also read the key; the Mac is Karl's trust domain by design.

``python3 answer_api.py --selftest`` runs the validation and logging against a temp
queue and a fake writer; it needs no FastAPI (the route is exercised too when
FastAPI's TestClient is importable).
"""

from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HOME = Path.home()
BRAIN = Path(os.environ.get("FLEET_BRAIN") or (HOME / "brain"))
QUEUE_FILE = BRAIN / "queue" / "needs-you.json"
WRITER = BRAIN / "tools" / "needs-you-write"
FLAG_FILE = Path(os.environ.get("FLEET_ANSWER_FLAG") or (HOME / ".config" / "lucky-loop" / "fleet-answer-verb"))
STATE_DIR = Path(os.environ.get("FLEET_ANSWER_STATE") or (HOME / ".local" / "state" / "lucky-loop" / "page-answer"))

SURFACE = "page"
CHANNEL_FILE = Path(os.environ.get("FLEET_ANSWER_CHANNEL")
                    or (HOME / ".config" / "lucky-loop" / "fleet-answer-channel.sha256"))
CHANNEL_HEADER = "x-fleet-answer-key"   # the page key's header (the Desktop sends X-Fleet-Answer-Key)
WHO = "page — unverified"       # the server cannot know who clicked; it never writes "karl" in the log
DONE_BY = "karl — page"         # the council's doneBy, written ONLY for a request that carried the page key
TOKEN_TTL_S = 900
CONFIRM_TTL_S = 90
WRITER_TIMEOUT_S = 90
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
WORD_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
BODY_KEYS = {"id", "word", "exp", "token", "confirm_exp", "confirm"}
HOW_TO_ENABLE = ("Three switches, all default off: the page key (hermes/tools/answer-channel-rotate on the Mac "
                 "writes the key into the Desktop and its sha256 to ~/.config/lucky-loop/fleet-answer-channel.sha256 "
                 "on the box); the box flag (echo on > ~/.config/lucky-loop/fleet-answer-verb, read per request); "
                 "the page flag (ANSWER_ON_PAGE = true in plugin.js, installed on the Mac).")

_KEY = secrets.token_bytes(32)   # this process only; a restart invalidates every open offer
_USED: Dict[str, float] = {}     # token -> exp, so a replay is refused before the queue is read
_LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# the flag, the key, the log
# --------------------------------------------------------------------------- #
def enabled() -> bool:
    try:
        return FLAG_FILE.read_text(encoding="utf-8").strip().splitlines()[0].strip().lower() == "on"
    except (OSError, IndexError):
        return False


def _sign(kind: str, cid: str, word: str, exp: int) -> str:
    return hmac.new(_KEY, f"{kind}|{cid}|{word}|{exp}".encode("utf-8"), hashlib.sha256).hexdigest()


def _now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _verifier() -> Optional[str]:
    """The stored sha256 (64 hex) of the page key, or None: absent, unreadable, malformed,
    or readable/writable by group or other (a verifier anyone may replace is no verifier)."""
    try:
        st = CHANNEL_FILE.stat()
        if st.st_mode & 0o077 or st.st_uid != os.getuid():
            return None
        v = CHANNEL_FILE.read_text(encoding="ascii").strip().lower()
    except (OSError, ValueError):
        return None
    return v if re.fullmatch(r"[0-9a-f]{64}", v) else None


def key_check(presented: Optional[str]) -> str:
    """'match' | 'missing' | 'wrong' | 'no-verifier'. Hashes what arrived and compares in
    constant time; the presented value is never stored, returned or logged."""
    v = _verifier()
    if v is None:
        return "no-verifier"
    if not presented:
        return "missing"
    got = hashlib.sha256(str(presented)[:512].encode("utf-8")).hexdigest()
    return "match" if hmac.compare_digest(got, v) else "wrong"


def log(verdict: str, cid: Optional[str], word: Optional[str], detail: str = "", client: Optional[str] = None,
        origin: Optional[str] = None, agent: Optional[str] = None, key: Optional[str] = None) -> None:
    """One line per call, refusals included. Never a token or key, never a body beyond id and word.
    ``key`` is key_check()'s verdict only. Origin and User-Agent are logged as claimed (cut to 160)."""
    rec = {"t": _now_z(), "who": WHO, "surface": SURFACE, "id": cid, "word": word,
           "verdict": verdict, "detail": str(detail)[:300], "page_key": key,
           "origin": (origin or "")[:160] or None, "user_agent": (agent or "")[:160] or None}
    if client:
        rec["client"] = client
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with open(STATE_DIR / "log.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass


# --------------------------------------------------------------------------- #
# offers: what the page may send, per card
# --------------------------------------------------------------------------- #
def words_of(item: Dict[str, Any]) -> List[str]:
    """The card's own plain option words, then `later`. A word that is not plain is not offered."""
    if not ID_RE.match(str(item.get("id", ""))):
        return []
    opts = [str(o).lower() for o in (item.get("options") or []) if WORD_RE.match(str(o).lower())]
    return [o for o in opts if o != "later"] + ["later"]


def offer(item: Dict[str, Any], now: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Signed tokens for exactly this card's words. None when the verb is off or the card cannot take one."""
    if not enabled() or item.get("done"):
        return None
    words = words_of(item)
    if not words:
        return None
    exp = int(now if now is not None else time.time()) + TOKEN_TTL_S
    return {"exp": exp, "tier": item.get("tier"), "confirm": item.get("tier") == 3,
            "tokens": {w: _sign("offer", str(item["id"]), w, exp) for w in words}}


# --------------------------------------------------------------------------- #
# validation
# --------------------------------------------------------------------------- #
class Refusal(Exception):
    def __init__(self, status: int, verdict: str, detail: str):
        super().__init__(detail)
        self.status, self.verdict, self.detail = status, verdict, detail


def _queue_items() -> List[Dict[str, Any]]:
    try:
        return list(json.loads(QUEUE_FILE.read_text(encoding="utf-8")).get("items", []))
    except FileNotFoundError:
        raise Refusal(503, "refused", "the queue file is absent on this box")
    except (OSError, ValueError) as e:
        raise Refusal(503, "refused", f"the queue is unreadable: {type(e).__name__}")


def validate(body: Any, now: Optional[int] = None) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Returns (card, clean body) or raises Refusal. Reads the box clone's queue; the writer re-checks the hub's."""
    now = int(now if now is not None else time.time())
    if not isinstance(body, dict):
        raise Refusal(400, "refused", "the body is one JSON object")
    extra = set(body) - BODY_KEYS
    if extra:
        raise Refusal(400, "refused", "unknown field(s): " + ", ".join(sorted(map(str, extra)))[:120])
    cid, word = body.get("id"), body.get("word")
    if not isinstance(cid, str) or not ID_RE.match(cid):
        raise Refusal(400, "refused", "id must be one card's full plain id")
    if not isinstance(word, str) or not WORD_RE.match(word):
        raise Refusal(400, "refused", "word must be one plain lowercase word")
    exp, tok = body.get("exp"), body.get("token")
    if not isinstance(exp, int) or isinstance(exp, bool) or not isinstance(tok, str):
        raise Refusal(400, "refused", "exp and token are required")
    if not hmac.compare_digest(tok, _sign("offer", cid, word, exp)):
        raise Refusal(403, "refused", "token does not match this card and word (or the server restarted)")
    if exp < now:
        raise Refusal(403, "refused", "the offer expired; the page re-reads it on its next sample")
    if tok in _USED:
        raise Refusal(409, "refused", "this offer was already used")
    items = _queue_items()
    card = next((i for i in items if str(i.get("id")) == cid), None)
    if card is None:
        raise Refusal(409, "refused", "unknown card")
    if card.get("done"):
        raise Refusal(409, "refused", f"already done ({card.get('answer') or 'no word'}) — only Karl reopens a card")
    if word not in words_of(card):
        raise Refusal(409, "refused", "not one of this card's words: " + ", ".join(words_of(card)))
    clean = {"id": cid, "word": word, "token": tok}
    if card.get("tier") == 3:
        cexp, ctok = body.get("confirm_exp"), body.get("confirm")
        if cexp is None and ctok is None:
            clean["needs_confirm"] = True
            return card, clean
        if not isinstance(cexp, int) or isinstance(cexp, bool) or not isinstance(ctok, str):
            raise Refusal(400, "refused", "confirm_exp and confirm go together")
        if not hmac.compare_digest(ctok, _sign("confirm", cid, word, cexp)):
            raise Refusal(403, "refused", "the confirm token does not match this card and word")
        if cexp < now:
            raise Refusal(403, "refused", "the confirm expired; click the word again")
    return card, clean


# --------------------------------------------------------------------------- #
# the hand-off: the vault's own writer, never a new one
# --------------------------------------------------------------------------- #
def run_writer(cid: str, word: str) -> Tuple[int, str]:
    """needs-you-write with one op. Exit: 0 recorded · 1 not recorded · 2 refused · 3 recorded, box clone NOT updated."""
    op = {"id": cid, "answer": word}
    if word != "later":
        op["by"] = f"{DONE_BY} {word}"  # doneBy "karl — page <word>"; answer() reaches here only with the page key
    env = {**os.environ, "NYW_REPO": str(BRAIN), "NYW_REMOTE": "origin",
           # the writer runs ON the box clone, so the box check is this clone's own HEAD
           "NYW_BOX_CMD": f"git -C '{BRAIN}' rev-parse HEAD"}
    try:
        # its own session, so a timeout can kill the writer AND the git/ssh children it started
        p = subprocess.Popen([sys.executable, str(WRITER), "--message", f"page: {cid} = {word}"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, env=env, start_new_session=True)
    except OSError as e:
        return 1, f"the writer could not start: {type(e).__name__}"
    try:
        out, err = p.communicate(json.dumps([op]), timeout=WRITER_TIMEOUT_S)
        return p.returncode, (out + err).strip()[-600:]
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            p.communicate(timeout=5)
        except Exception:
            pass
        # the push may or may not have landed before the kill: never say "not recorded"
        return TIMED_OUT, f"the writer ran past {WRITER_TIMEOUT_S}s and was killed"


TIMED_OUT = -9
WRITER_VERDICT = {0: (200, "recorded"), 3: (200, "recorded; this page will lag until the box clone syncs"),
                  2: (409, "refused by the writer"), 1: (502, "not recorded"),
                  TIMED_OUT: (504, "outcome unknown — check the queue")}


def answer(body: Any, client: Optional[str] = None, now: Optional[int] = None,
           writer=None, origin: Optional[str] = None, agent: Optional[str] = None,
           key: Optional[str] = None) -> Tuple[int, Dict[str, Any]]:
    """The whole verb as a function: (http status, response). The route is a thin shell around it."""
    raw_id = body.get("id") if isinstance(body, dict) and isinstance(body.get("id"), str) else None
    raw_word = body.get("word") if isinstance(body, dict) and isinstance(body.get("word"), str) else None
    safe_id = raw_id if raw_id and ID_RE.match(raw_id) else None
    safe_word = raw_word if raw_word and WORD_RE.match(raw_word) else None
    kv = key_check(key) if enabled() else None
    key = None  # the value goes no further than key_check
    L = lambda v, c, w, d: log(v, c, w, d, client, origin, agent, kv)
    if not enabled():
        L("off", safe_id, safe_word, "the verb is off on this box")
        return 404, {"ok": False, "verdict": "off", "detail": "the answer verb is off on this box"}
    # Only the page's channel may answer: the Mac-only key, checked against the box's sha256 of it.
    if kv != "match":
        L("refused-key", safe_id, safe_word, f"page key {kv}")
        return 403, {"ok": False, "verdict": "refused",
                     "detail": f"this request does not carry the page's key ({kv})"}
    with _LOCK:     # one answer at a time in this process; the file lock covers a second process
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            lk = open(STATE_DIR / "answer.lock", "w")
        except OSError as e:
            # nothing can be logged either, so nothing is written
            return 503, {"ok": False, "verdict": "refused",
                         "detail": f"the answer log's directory is not writable ({type(e).__name__}); nothing written"}
        with lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                card, clean = validate(body, now)
            except Refusal as r:
                L(r.verdict, safe_id, safe_word, r.detail)
                return r.status, {"ok": False, "verdict": r.verdict, "detail": r.detail}
            cid, word = clean["id"], clean["word"]
            if clean.get("needs_confirm"):
                cexp = int(now if now is not None else time.time()) + CONFIRM_TTL_S
                L("confirm-asked", cid, word, "tier 3: nothing written until the second click")
                return 200, {"ok": False, "verdict": "confirm", "id": cid, "word": word,
                             "title": str(card.get("title") or "")[:200],
                             "confirm": {"exp": cexp, "token": _sign("confirm", cid, word, cexp)},
                             "detail": "tier 3 — click once more to send this word"}
            _USED[clean["token"]] = time.time() + TOKEN_TTL_S
            for t, e in list(_USED.items()):
                if e < time.time():
                    _USED.pop(t, None)
            rc, out = (writer or run_writer)(cid, word)
            status, verdict = WRITER_VERDICT.get(rc, (502, f"writer exit {rc}"))
            L(verdict, cid, word, out.splitlines()[-1] if out else "")
            return status, {"ok": rc in (0, 3), "verdict": verdict, "id": cid, "word": word,
                            "detail": verdict if rc in (3, TIMED_OUT) else (out.splitlines()[-1][:300] if out else "")}


# --------------------------------------------------------------------------- #
# the route (only when FastAPI is present — the selftest runs without it)
# --------------------------------------------------------------------------- #
try:
    from fastapi import APIRouter, Request
    from fastapi.responses import JSONResponse
    from starlette.concurrency import run_in_threadpool

    router = APIRouter()

    @router.post("/answer")
    async def answer_route(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = None
        client = request.client.host if request.client else None
        # answer() blocks on git for up to WRITER_TIMEOUT_S: off the event loop, so chat keeps running
        status, resp = await run_in_threadpool(answer, body, client=client,
                                               origin=request.headers.get("origin"),
                                               agent=request.headers.get("user-agent"),
                                               key=request.headers.get(CHANNEL_HEADER))
        return JSONResponse(resp, status_code=status)

    @router.get("/answer/channel")
    async def channel_route(request: Request):
        """Whether THIS request carried the page key — the page asks before it draws a Send
        button, so a Desktop without the key shows why instead of a button that 403s. Writes
        nothing; logged (verdict only, never the value) so the verifier can see the Desktop's
        own requests arrive with page_key "match"."""
        on = enabled()
        kv = key_check(request.headers.get(CHANNEL_HEADER))
        log("channel-probe", None, None, f"page key {kv}; verb {'on' if on else 'off'}",
            request.client.host if request.client else None, request.headers.get("origin"),
            request.headers.get("user-agent"), kv)
        return JSONResponse({"enabled": on, "page_key": kv})
except ImportError:  # pragma: no cover - the box always has FastAPI
    router = None


# --------------------------------------------------------------------------- #
# selftest
# --------------------------------------------------------------------------- #
def selftest() -> int:
    global QUEUE_FILE, FLAG_FILE, STATE_DIR, CHANNEL_FILE, WRITER, WRITER_TIMEOUT_S
    fails: List[str] = []

    def ok(cond: bool, name: str) -> None:
        print(("  ok   " if cond else "  FAIL ") + name)
        if not cond:
            fails.append(name)

    saved = (QUEUE_FILE, FLAG_FILE, STATE_DIR, CHANNEL_FILE, WRITER, WRITER_TIMEOUT_S)
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        QUEUE_FILE, FLAG_FILE, STATE_DIR = td / "needs-you.json", td / "flag", td / "state"
        CHANNEL_FILE = td / "channel.sha256"
        KEY = secrets.token_urlsafe(32)   # the selftest's own page key; never the real one
        WRITER = td / "no-writer-here"   # any path that reached the real writer would fail to start, not write
        PAGE = "app://selftest-page"
        q = {"schema": 1, "items": [
            {"id": "alpha-2026-01-01", "title": "Merge the branch", "tier": 3, "options": ["hold", "merge"]},
            {"id": "beta-2026-01-01", "title": "Retry the job", "tier": 1, "options": ["retry", "drop"]},
            {"id": "gamma-2026-01-01", "title": "Old", "tier": 1, "options": ["done"], "done": True, "answer": "done"},
            {"id": "delta-2026-01-01", "title": "Odd words", "tier": 1, "options": ["Keep It", "go"]},
        ]}
        QUEUE_FILE.write_text(json.dumps(q))
        calls: List[Tuple[str, str]] = []

        def fake_writer(cid: str, word: str) -> Tuple[int, str]:
            calls.append((cid, word))
            d = json.loads(QUEUE_FILE.read_text())
            for i in d["items"]:
                if i["id"] == cid and word != "later":
                    i.update({"done": True, "answer": word, "doneBy": f"{DONE_BY} {word}"})
            QUEUE_FILE.write_text(json.dumps(d))
            return 0, f"  {cid}: {word}\nrecorded abc1234 · pushed to origin/master"

        items = {i["id"]: i for i in q["items"]}
        lines = lambda: [json.loads(x) for x in (STATE_DIR / "log.jsonl").read_text().splitlines()] \
            if (STATE_DIR / "log.jsonl").exists() else []
        A = lambda body, **kw: answer(body, client="127.0.0.1", writer=fake_writer,
                                      **{"origin": PAGE, "agent": "selftest-agent/1", "key": KEY, **kw})

        # 1. off by default: no flag file -> 404, no offer, nothing written, the call is logged
        ok(not enabled(), "no flag file: the verb is off")
        ok(offer(items["beta-2026-01-01"]) is None, "off: no offer is made")
        st, r = A({"id": "beta-2026-01-01", "word": "retry", "exp": 0, "token": "x"})
        ok(st == 404 and r["verdict"] == "off" and not calls, "off: the route answers 404 and writes nothing")
        ok(lines() and lines()[-1]["verdict"] == "off", "off: the refused call is still logged")
        FLAG_FILE.write_text("off\n")
        ok(not enabled(), "a flag file that says off keeps it off")
        FLAG_FILE.write_text("on\n")
        ok(enabled(), "a flag file that says on switches it on (read per request)")

        # 1b. with the flag on, the page key gates every answer: missing, wrong, no verifier -> 403, logged
        probe = {"id": "beta-2026-01-01", "word": "retry", "exp": 0, "token": "x"}
        st, r = A(probe)
        ok(st == 403 and not calls and lines()[-1]["page_key"] == "no-verifier",
           "no verifier on file: even the right key is refused 403")
        CHANNEL_FILE.write_text(hashlib.sha256(KEY.encode()).hexdigest() + "\n")
        os.chmod(CHANNEL_FILE, 0o644)
        st, r = A(probe)
        ok(st == 403 and not calls and lines()[-1]["page_key"] == "no-verifier",
           "a verifier group/other can read is no verifier: refused 403")
        os.chmod(CHANNEL_FILE, 0o600)
        st, r = A(probe, key=None, agent="curl/8.0")
        ok(st == 403 and not calls and r["detail"].endswith("(missing)"),
           "missing key (the session token alone, e.g. a box process): refused 403")
        last = lines()[-1]
        ok(last["verdict"] == "refused-key" and last["page_key"] == "missing" and last["user_agent"] == "curl/8.0",
           "the refusal is logged with the key verdict and the User-Agent it claimed")
        st, r = A(probe, key=KEY + "x", origin="http://evil.example")
        ok(st == 403 and not calls and lines()[-1]["page_key"] == "wrong", "wrong key: refused 403")
        ok(lines()[-1]["origin"] == "http://evil.example", "a claimed Origin is still logged as sent")
        st, r = A(probe, key=hashlib.sha256(KEY.encode()).hexdigest())
        ok(st == 403 and not calls and lines()[-1]["page_key"] == "wrong",
           "the stored hash itself is not a key (the box cannot replay what it holds)")
        st, r = A(probe, origin=None)
        ok(st == 403 and r["verdict"] == "refused" and lines()[-1]["page_key"] == "match"
           and "token" in r["detail"], "right key, no Origin (the Desktop's main process): past the gate, judged on the body")
        ok(all("karl" not in str(x.get("who")) for x in lines()), "the log never claims karl as who")
        ok(KEY not in (STATE_DIR / "log.jsonl").read_text()
           and hashlib.sha256(KEY.encode()).hexdigest() not in (STATE_DIR / "log.jsonl").read_text(),
           "neither the key nor its hash ever reaches the log")

        # 2. offers carry exactly the card's words + later
        ob = offer(items["beta-2026-01-01"])
        ok(ob and sorted(ob["tokens"]) == ["drop", "later", "retry"] and not ob["confirm"], "tier 1 offer: its words and later")
        od = offer(items["delta-2026-01-01"])
        ok(od and sorted(od["tokens"]) == ["go", "later"], "a word that is not plain is not offered")
        ok(offer(items["gamma-2026-01-01"]) is None, "a done card gets no offer")

        # 3. refusals write nothing
        base = {"id": "beta-2026-01-01", "word": "retry", "exp": ob["exp"], "token": ob["tokens"]["retry"]}
        for body, want, name in [
            (None, 400, "a non-object body"),
            ([base], 400, "a list (several cards in one call)"),
            ({**base, "note": "free text"}, 400, "an extra field (free text)"),
            ({**base, "id": "beta"}, 403, "a substring id (token mismatch)"),
            ({**base, "id": "../x"}, 400, "an id that is not plain"),
            ({**base, "word": "drop"}, 403, "another word with this word's token"),
            ({**base, "word": "Retry"}, 400, "a word that is not plain"),
            ({**base, "token": "0" * 64}, 403, "a forged token"),
            ({**base, "exp": ob["exp"] + 1}, 403, "a moved expiry"),
            ({**base, "exp": True}, 400, "a boolean expiry"),
        ]:
            st, r = A(body)
            ok(st == want and not r["ok"] and not calls, f"refused {st}: {name}")
        st, r = A(base, now=ob["exp"] + 1)
        ok(st == 403 and "expired" in r["detail"] and not calls, "refused 403: an expired offer")
        og = {"exp": ob["exp"], "t": _sign("offer", "gamma-2026-01-01", "done", ob["exp"])}
        st, r = A({"id": "gamma-2026-01-01", "word": "done", "exp": og["exp"], "token": og["t"]})
        ok(st == 409 and "already done" in r["detail"] and not calls, "refused 409: a done card")
        on = {"exp": ob["exp"], "t": _sign("offer", "nope-2026-01-01", "go", ob["exp"])}
        st, r = A({"id": "nope-2026-01-01", "word": "go", "exp": on["exp"], "token": on["t"]})
        ok(st == 409 and r["detail"] == "unknown card" and not calls, "refused 409: an unknown card")
        ox = _sign("offer", "beta-2026-01-01", "merge", ob["exp"])
        st, r = A({"id": "beta-2026-01-01", "word": "merge", "exp": ob["exp"], "token": ox})
        ok(st == 409 and "not one of" in r["detail"] and not calls, "refused 409: an off-list word, even when signed")

        # 4. a tier-1 answer: handed to the writer once, logged, and not replayable
        st, r = A(base)
        ok(st == 200 and r["ok"] and r["verdict"] == "recorded" and calls == [("beta-2026-01-01", "retry")],
           "tier 1: one click hands exactly (id, word) to the writer")
        last = lines()[-1]
        ok(last["verdict"] == "recorded" and last["id"] == "beta-2026-01-01" and last["word"] == "retry"
           and last["surface"] == "page" and last["who"] == WHO and last.get("t") and last.get("client") == "127.0.0.1"
           and last["origin"] == PAGE and last["user_agent"] == "selftest-agent/1",
           "the log line holds when, card, word, surface=page, client, Origin and User-Agent")
        ok(all(t not in (STATE_DIR / "log.jsonl").read_text() for t in ob["tokens"].values())
           and not any("token" in x for x in lines()),
           "no token ever reaches the log")
        st, r = A(base)
        ok(st == 409 and len(calls) == 1, "a replay of the same offer is refused")

        # 5. tier 3: the first click writes nothing and returns a confirm; only the second is handed on
        oa = offer(items["alpha-2026-01-01"])
        ok(oa["confirm"] and oa["tokens"]["hold"], "tier 3 offer says a confirm is needed")
        body = {"id": "alpha-2026-01-01", "word": "merge", "exp": oa["exp"], "token": oa["tokens"]["merge"]}
        st, r = A(body)
        ok(st == 200 and r["verdict"] == "confirm" and r["title"] == "Merge the branch" and len(calls) == 1,
           "tier 3 first click: confirm with title and word, nothing written")
        c = r["confirm"]
        st, r2 = A({**body, "confirm_exp": c["exp"], "confirm": _sign("confirm", "alpha-2026-01-01", "hold", c["exp"])})
        ok(st == 403 and len(calls) == 1, "tier 3: a confirm for another word is refused")
        st, r2 = A({**body, "confirm_exp": c["exp"], "confirm": c["token"]}, now=c["exp"] + 1)
        ok(st == 403 and len(calls) == 1, "tier 3: an expired confirm is refused")
        st, r2 = A({**body, "confirm_exp": c["exp"], "confirm": c["token"]})
        ok(st == 200 and r2["ok"] and calls[-1] == ("alpha-2026-01-01", "merge"), "tier 3 second click: handed to the writer")
        ok([x["verdict"] for x in lines()][-2:] in (["refused", "recorded"],) and
           any(x["verdict"] == "confirm-asked" for x in lines()), "both tier-3 clicks are logged")

        # 6. the writer's own verdicts are passed through, not dressed up
        o2 = offer(items["delta-2026-01-01"])
        st, r = answer({"id": "delta-2026-01-01", "word": "go", "exp": o2["exp"], "token": o2["tokens"]["go"]},
                       writer=lambda c, w: (2, "refused — delta: 'go' is not one of: keep"), origin=PAGE, key=KEY)
        ok(st == 409 and not r["ok"] and r["verdict"] == "refused by the writer", "a writer refusal is reported as refused")
        o3 = offer(items["delta-2026-01-01"])
        st, r = answer({"id": "delta-2026-01-01", "word": "later", "exp": o3["exp"], "token": o3["tokens"]["later"]},
                       writer=lambda c, w: (1, "not recorded — 3 pushes rejected"), origin=PAGE, key=KEY)
        ok(st == 502 and not r["ok"], "a writer that could not push is reported as not recorded")
        _USED.clear()  # offers minted in the same second share a token; the replay guard is per token
        o4 = offer(items["delta-2026-01-01"])
        st, r = answer({"id": "delta-2026-01-01", "word": "go", "exp": o4["exp"], "token": o4["tokens"]["go"]},
                       writer=lambda c, w: (3, "recorded … box clone NOT updated"), origin=PAGE, key=KEY)
        ok(st == 200 and r["ok"] and r["detail"] == "recorded; this page will lag until the box clone syncs",
           "exit 3 is ok, and says the page will lag until the box clone syncs")
        _USED.clear()  # offers minted in the same second share a token; the replay guard is per token
        o5 = offer(items["delta-2026-01-01"])
        st, r = answer({"id": "delta-2026-01-01", "word": "later", "exp": o5["exp"], "token": o5["tokens"]["later"]},
                       writer=lambda c, w: (TIMED_OUT, "killed"), origin=PAGE, key=KEY)
        ok(st == 504 and not r["ok"] and r["verdict"] == "outcome unknown — check the queue",
           "a timed-out writer is reported as outcome unknown, never as not recorded")

        # 6b. the real timeout kills the writer's whole process group (its children too)
        pidf = td / "child.pid"
        slow = td / "slow-writer"
        slow.write_text("import subprocess, sys, time\n"
                        f"c = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
                        f"open({str(pidf)!r}, 'w').write(str(c.pid))\n"
                        "time.sleep(60)\n")
        WRITER, WRITER_TIMEOUT_S = slow, 1
        t0 = time.time()
        rc, out = run_writer("beta-2026-01-01", "drop")
        time.sleep(0.3)
        child = int(pidf.read_text()) if pidf.exists() else None
        alive = True
        if child:
            try:
                os.kill(child, 0)
            except ProcessLookupError:
                alive = False
            except PermissionError:
                alive = True
        ok(rc == TIMED_OUT and time.time() - t0 < 10 and child and not alive,
           "on timeout the writer and the child it started are both killed")
        WRITER, WRITER_TIMEOUT_S = saved[4], saved[5]

        # 6c. an unwritable state dir is a 503 with a JSON reason, not a 500
        keep_state = STATE_DIR
        (td / "a-file").write_text("x")
        STATE_DIR = td / "a-file" / "state"
        _USED.clear()  # offers minted in the same second share a token; the replay guard is per token
        o6 = offer(items["delta-2026-01-01"])
        st, r = answer({"id": "delta-2026-01-01", "word": "go", "exp": o6["exp"], "token": o6["tokens"]["go"]},
                       writer=fake_writer, origin=PAGE, key=KEY)
        ok(st == 503 and not r["ok"] and "not writable" in r["detail"], "an unwritable state dir answers 503 with a reason")
        STATE_DIR = keep_state

        # 7. the real hand-off builds decide's op and the council's doneBy
        seen: Dict[str, Any] = {}

        class P:
            returncode, pid = 0, 0

            def __init__(self, argv, **kw):
                seen.update({"argv": argv, "env": kw.get("env", {}), "session": kw.get("start_new_session")})

            def communicate(self, inp=None, timeout=None):
                seen["ops"] = json.loads(inp)
                return "recorded", ""
        real = subprocess.Popen
        subprocess.Popen = P
        try:
            rc, _ = run_writer("beta-2026-01-01", "drop")
            ok(rc == 0 and seen["ops"] == [{"id": "beta-2026-01-01", "answer": "drop", "by": "karl — page drop"}]
               and str(seen["argv"][1]).endswith("needs-you-write") and "--message" in seen["argv"]
               and seen["env"].get("NYW_BOX_CMD", "").endswith("rev-parse HEAD") and seen["session"] is True,
               "run_writer hands needs-you-write one op with doneBy `karl — page <word>`")
            run_writer("beta-2026-01-01", "later")
            ok(seen["ops"] == [{"id": "beta-2026-01-01", "answer": "later"}], "`later` goes as decide's own park op")
        finally:
            subprocess.Popen = real

        # 8. the route itself, when FastAPI's TestClient is here
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
            app = FastAPI()
            app.include_router(router)
            tc = TestClient(app)
            FLAG_FILE.write_text("")
            ok(tc.post("/answer", json=base).status_code == 404, "route: 404 while the flag is off")
            FLAG_FILE.write_text("on\n")
            ok(tc.post("/answer", content=b"not json", headers={"content-type": "application/json"}).status_code == 403,
               "route: 403 without the page key, before the body is judged")
            ok(tc.post("/answer", content=b"not json",
                       headers={"content-type": "application/json", "X-Fleet-Answer-Key": KEY + "x"}).status_code == 403,
               "route: 403 with a wrong page key")
            ok(tc.post("/answer", content=b"not json",
                       headers={"content-type": "application/json", "X-Fleet-Answer-Key": KEY}).status_code == 400,
               "route: 400 on a body that is not JSON (right page key, header read case-insensitively)")
            _USED.clear()
            stub = td / "stub-writer"   # never the real writer: a selftest must not reach the vault
            stub.write_text("import sys; sys.stdin.read(); print('recorded stub')\n")
            WRITER = stub
            o7 = offer(items["delta-2026-01-01"])
            rr = tc.post("/answer", json={"id": "delta-2026-01-01", "word": "go", "exp": o7["exp"], "token": o7["tokens"]["go"]},
                         headers={"origin": PAGE, "user-agent": "route-test/1", "x-fleet-answer-key": KEY})
            WRITER = saved[4]
            ok(rr.status_code == 200 and rr.json()["verdict"] == "recorded" and lines()[-1]["user_agent"] == "route-test/1",
               "route: headers reach the log through the threadpool")
            cr = tc.get("/answer/channel", headers={"x-fleet-answer-key": KEY, "user-agent": "probe/1"}).json()
            ok(cr == {"enabled": True, "page_key": "match"} and lines()[-1]["verdict"] == "channel-probe"
               and lines()[-1]["page_key"] == "match", "route: GET /answer/channel says match, logged, writes nothing")
            ok(tc.get("/answer/channel").json()["page_key"] == "missing", "route: GET /answer/channel says missing")
            ok(KEY not in (STATE_DIR / "log.jsonl").read_text(), "route: the key never reaches the log")
        except ImportError:
            print("  skip route checks (no FastAPI TestClient here)")
    QUEUE_FILE, FLAG_FILE, STATE_DIR, CHANNEL_FILE, WRITER, WRITER_TIMEOUT_S = saved
    print(f"selftest: {'PASS' if not fails else 'FAIL'} — {len(fails)} failure(s)")
    return 0 if not fails else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    print(__doc__)

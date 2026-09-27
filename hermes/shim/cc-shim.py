#!/usr/bin/env python3
"""cc-shim — SWITCH 1, STAGED OFF: seat a named Claude Code session in a Hermes room.

The October board row `shim-claude-code-agents-in-hermes-rooms` (Karl's word ADOPT 2026-09-16;
not before 2026-10-01, AGENT-OS rule 5: one architecture change a month). This is its code,
staged: a local OpenAI-compatible endpoint that fronts ONE named Claude Code session per
"model", so a Hermes profile pointed at it (provider custom, base_url this shim) can sit in a
Bot Mode room as a member.

    POST /v1/chat/completions {"model": "<seat>", "messages": [...]}  ->  claude -p --resume <session> <last user text>
    GET  /v1/models                                                   ->  the seats in seats.json

It refuses to START unless all three hold (so it cannot be switched on by accident):
  1. today is on or after 2026-10-01 (NOT_BEFORE; Karl's rule, in code);
  2. ~/.config/lucky-loop/cc-shim/on holds the word `on` (read on every request too: `off` stops answers at once);
  3. ~/.config/lucky-loop/cc-shim/token exists, mode 600 (the bearer every request must carry).

And while it runs:
  * it binds 127.0.0.1 only;
  * a seat must be listed in ~/.config/lucky-loop/cc-shim/seats.json ({"seat": {"session": "<claude session id>",
    "cwd": "<dir>"}}); nothing else can be resumed;
  * the resumed session runs with `--permission-mode plan` by default: a room member ANSWERS, it does not act
    (Hermes stays interface, never orchestration — the 08-28 rule). A seat may name another mode in seats.json,
    and that line is Karl's to write;
  * one request at a time per seat (a resumed session is not re-entrant); a second gets 429;
  * every request is logged (time, seat, verdict, seconds — never text) to ~/.local/state/lucky-loop/cc-shim/log.jsonl.

  cc-shim.py serve [--port 11610]     start (refuses unless the three conditions hold)
  cc-shim.py --selftest               exercise the handler with a fake claude; no network, no real session
"""
from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

NOT_BEFORE = datetime.date(2026, 10, 1)
CONF = Path(os.environ.get("CC_SHIM_CONF") or Path.home() / ".config/lucky-loop/cc-shim")
STATE = Path(os.environ.get("CC_SHIM_STATE") or Path.home() / ".local/state/lucky-loop/cc-shim")
CLAUDE = os.environ.get("CC_SHIM_CLAUDE") or "claude"
TIMEOUT_S = 600
MODES = {"plan", "default", "acceptEdits"}  # never bypassPermissions through a room
_busy: Dict[str, threading.Lock] = {}


def switched_on() -> bool:
    try:
        return (CONF / "on").read_text().strip() == "on"
    except OSError:
        return False


def token() -> Optional[str]:
    p = CONF / "token"
    try:
        if p.stat().st_mode & 0o077:
            return None  # readable by others: refuse rather than trust it
        t = p.read_text().strip()
        return t or None
    except OSError:
        return None


def seats() -> Dict[str, Dict[str, Any]]:
    try:
        d = json.loads((CONF / "seats.json").read_text())
        return {k: v for k, v in d.items() if isinstance(v, dict) and v.get("session")}
    except (OSError, ValueError):
        return {}


def start_refusal(today: Optional[datetime.date] = None) -> Optional[str]:
    today = today or datetime.date.today()
    if today < NOT_BEFORE:
        return f"not before {NOT_BEFORE.isoformat()} (Karl's rule 5 slot for October)"
    if not switched_on():
        return f"{CONF / 'on'} does not hold `on`"
    if not token():
        return f"{CONF / 'token'} is missing, empty, or readable by others"
    return None


def log(seat: str, verdict: str, secs: float = 0.0) -> None:
    try:
        STATE.mkdir(parents=True, exist_ok=True)
        with open(STATE / "log.jsonl", "a") as f:
            f.write(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                                "seat": seat, "verdict": verdict, "secs": round(secs, 1)}) + "\n")
    except OSError:
        pass


def last_user_text(messages: List[Dict[str, Any]]) -> str:
    for m in reversed(messages or []):
        if m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, list):
                return " ".join(p.get("text", "") for p in c if isinstance(p, dict))
            return str(c or "")
    return ""


def complete(body: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    """(status, OpenAI-shaped body). Never raises."""
    if not switched_on():
        return 503, {"error": {"message": "cc-shim is switched off"}}
    seat = str(body.get("model") or "")
    s = seats().get(seat)
    if not s:
        log(seat[:40], "unknown-seat")
        return 404, {"error": {"message": f"no seat {seat!r} in seats.json"}}
    text = last_user_text(body.get("messages") or []).strip()
    if not text:
        return 400, {"error": {"message": "no user message"}}
    mode = s.get("mode", "plan")
    if mode not in MODES:
        return 403, {"error": {"message": f"permission mode {mode!r} is not allowed through a room"}}
    lock = _busy.setdefault(seat, threading.Lock())
    if not lock.acquire(blocking=False):
        log(seat, "busy")
        return 429, {"error": {"message": f"{seat} is answering another message"}}
    t0 = time.time()
    try:
        r = subprocess.run([CLAUDE, "-p", "--resume", str(s["session"]), "--permission-mode", mode,
                            "--output-format", "text", text],
                           cwd=os.path.expanduser(s.get("cwd") or "~"), capture_output=True, text=True, timeout=TIMEOUT_S)
        out = (r.stdout or "").strip()
        if r.returncode != 0 or not out:
            log(seat, f"claude-rc-{r.returncode}", time.time() - t0)
            return 502, {"error": {"message": f"claude exited {r.returncode}"}}
    except subprocess.TimeoutExpired:
        log(seat, "timeout", time.time() - t0)
        return 504, {"error": {"message": f"claude ran past {TIMEOUT_S}s"}}
    finally:
        lock.release()
    log(seat, "answered", time.time() - t0)
    now = int(time.time())
    return 200, {"id": f"chatcmpl-ccshim-{now}", "object": "chat.completion", "created": now, "model": seat,
                 "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": out}}],
                 "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}


class Handler(BaseHTTPRequestHandler):
    def _auth(self) -> bool:
        t = token()
        return bool(t) and self.headers.get("Authorization", "") == f"Bearer {t}"

    def _send(self, status: int, body: Dict[str, Any]) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if not self._auth():
            return self._send(401, {"error": {"message": "unauthorized"}})
        if self.path.rstrip("/") == "/v1/models":
            return self._send(200, {"object": "list", "data": [{"id": k, "object": "model", "owned_by": "cc-shim"} for k in seats()]})
        self._send(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        if not self._auth():
            return self._send(401, {"error": {"message": "unauthorized"}})
        if self.path.rstrip("/") != "/v1/chat/completions":
            return self._send(404, {"error": {"message": "not found"}})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 1_000_000)) or b"{}")
        except ValueError:
            return self._send(400, {"error": {"message": "bad json"}})
        status, out = complete(body)
        if status == 200 and body.get("stream"):
            # one chunk, then [DONE]: the answer arrives whole (a resumed session does not stream here)
            chunk = {"id": out["id"], "object": "chat.completion.chunk", "created": out["created"], "model": out["model"],
                     "choices": [{"index": 0, "delta": {"role": "assistant", "content": out["choices"][0]["message"]["content"]},
                                  "finish_reason": "stop"}]}
            data = f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._send(status, out)

    def log_message(self, *_: Any) -> None:  # no request lines (they can carry nothing, but stay quiet)
        pass


def serve(port: int) -> int:
    why = start_refusal()
    if why:
        print(f"cc-shim refused to start: {why}", file=sys.stderr)
        return 2
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"cc-shim on 127.0.0.1:{port} · seats: {', '.join(seats()) or 'none'}", flush=True)
    srv.serve_forever()
    return 0


def selftest() -> int:
    import tempfile
    global CONF, STATE, CLAUDE
    fails = 0

    def ok(c: bool, name: str) -> None:
        nonlocal fails
        print(("ok   " if c else "FAIL ") + name)
        fails += 0 if c else 1

    with tempfile.TemporaryDirectory() as td:
        CONF, STATE = Path(td) / "conf", Path(td) / "state"
        CONF.mkdir()
        fake = Path(td) / "claude"
        fake.write_text("#!/bin/sh\necho \"seat answered: $3 in $5 mode\"\n")
        fake.chmod(0o755)
        CLAUDE = str(fake)
        ok(start_refusal(datetime.date(2026, 9, 30)) and "not before" in start_refusal(datetime.date(2026, 9, 30)),
           "refuses to start before 2026-10-01")
        ok("does not hold" in (start_refusal(datetime.date(2026, 10, 1)) or ""), "refuses to start while the flag is off")
        (CONF / "on").write_text("on\n")
        ok("token" in (start_refusal(datetime.date(2026, 10, 1)) or ""), "refuses to start with no token")
        (CONF / "token").write_text("t0k")
        (CONF / "token").chmod(0o644)
        ok("token" in (start_refusal(datetime.date(2026, 10, 1)) or ""), "refuses a token readable by others")
        (CONF / "token").chmod(0o600)
        ok(start_refusal(datetime.date(2026, 10, 1)) is None, "starts on/after 10-01 with the flag and a private token")
        (CONF / "seats.json").write_text(json.dumps({"lead": {"session": "abc-123", "cwd": td}, "wild": {"session": "x", "mode": "bypassPermissions"}}))
        st, b = complete({"model": "nobody", "messages": [{"role": "user", "content": "hi"}]})
        ok(st == 404, "an unlisted seat is refused")
        st, b = complete({"model": "wild", "messages": [{"role": "user", "content": "hi"}]})
        ok(st == 403, "bypassPermissions through a room is refused")
        st, b = complete({"model": "lead", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "status?"}]})
        ok(st == 200 and "abc-123 in plan mode" in b["choices"][0]["message"]["content"],
           "a listed seat resumes its own session, in plan mode by default")
        (CONF / "on").write_text("off")
        st, b = complete({"model": "lead", "messages": [{"role": "user", "content": "x"}]})
        ok(st == 503, "switching the flag off stops answers at once")
        ok("status?" not in (STATE / "log.jsonl").read_text(), "the log holds no message text")
    print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failing")
    return 1 if fails else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(selftest())
    if a[:1] == ["serve"]:
        port = int(a[a.index("--port") + 1]) if "--port" in a else 11610
        sys.exit(serve(port))
    print(__doc__)
    sys.exit(2)

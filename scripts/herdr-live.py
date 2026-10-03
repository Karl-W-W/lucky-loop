#!/usr/bin/env python3
"""herdr-live — every herdr agent's state, live, for the Hermes Desktop (mission v8 B3, 2026-10-02).

What it keeps current: ONE file on this Mac, ~/.local/state/lucky-loop/herdr-live.json
(schema "herdr-live/1"). The Desktop's Agents page (hermes/desktop-plugins/fleet/plugin.js,
route /agents) watches that file through the Desktop's own file watcher and re-renders when
it changes. F1 (the WhatsApp-like agent list) reads the same file; the row shape is the contract.

  * This Mac's herdr: `events.subscribe` on herdr's own socket (pane.agent_status_changed for
    every agent pane, plus pane/tab/workspace lifecycle). A state change is re-sampled 0.1 s
    after herdr announces it. A heartbeat re-samples every 5 s regardless, so a missed event
    costs at most 5 s, and `sampledAt` moving proves this producer is alive.
  * The box's herdr (the foreman opens tabs there): read every 15 s over the same ssh alias the
    60 s snapshot uses (`dgx-remote`), read-only. A failed read keeps the last rows, dated.

MAC-LOCAL BY DESIGN. The file carries terminal titles, and titles never leave this Mac: the
2026-09-16 L3 rule lets only SHAPE cross to the box (scripts/herdr-snapshot.sh still does that,
unchanged, every 60 s). This script opens no listening socket and sends nothing anywhere; the
ssh call only READS the box. It logs counts and errors, never a title. A title that looks like
a secret (the box's `_secretish` rule, copied from today_api.py) is withheld, not shown.

READ-ONLY toward herdr: agent.list, tab.list, workspace.list, events.subscribe. Nothing else.

  herdr-live.py              run (launchd KeepAlive: deploy/com.kww.herdr-live.plist)
  herdr-live.py --once       sample now and print the counts; writes nothing
  herdr-live.py --check      the file's age and counts against `agent.list` right now (the verify)
  herdr-live.py --selftest   against a fake herdr socket; no real herdr, no ssh, no real files
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import selectors
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

SCHEMA = "herdr-live/1"
HOME = os.path.expanduser("~")
STATES = ("working", "blocked", "idle", "done", "unknown")
GLOBAL_EVENTS = ("pane.created", "pane.closed", "pane.exited", "pane.agent_detected",
                 "tab.created", "tab.closed", "tab.renamed",
                 "workspace.created", "workspace.closed", "workspace.renamed")
# The remote side of the box read. herdr prints one JSON document per command; `@@` splits them.
BOX_CMD = ('export PATH="$HOME/.local/bin:$PATH"; command -v herdr >/dev/null 2>&1 || { echo NOHERDR; exit 0; }; '
           'herdr agent list 2>/dev/null; echo; echo @@; herdr tab list 2>/dev/null; echo; echo @@; '
           'herdr workspace list 2>/dev/null')

# --- the box's secret rule, copied from hermes/plugins/fleet/dashboard/today_api.py --------------
_SECRETISH_RE = re.compile(
    r"(-----BEGIN|\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abpr]-|\bAKIA[0-9A-Z]{12,}"
    r"|\bAIza[0-9A-Za-z_-]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.|(?:password|passwd|secret|token|api[_-]?key|bearer)\s*[:=]\s*\S{6,}"
    r"|\b[A-Fa-f0-9]{40,}\b)", re.I)
_KEYISH_RE = re.compile(r"(?<![A-Za-z0-9+_])(?=[A-Za-z0-9+_]*\d)(?=[A-Za-z0-9+_]*[A-Z])(?=[A-Za-z0-9+_]*[a-z])"
                        r"[A-Za-z0-9+_]{40,}={0,2}")
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")


def secretish(s: str) -> bool:
    return bool(_SECRETISH_RE.search(s) or _KEYISH_RE.search(s))


def iso(t: Optional[float] = None) -> str:
    d = datetime.fromtimestamp(time.time() if t is None else t, tz=timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


def write_json(path: str, obj: Any) -> None:
    """Atomic: tmp + rename. A half-written JSON is never what the Desktop reads."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def read_json(path: str) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


class Config:
    def __init__(self, state_dir: Optional[str] = None, sock: Optional[str] = None, box_host: Optional[str] = None,
                 heartbeat_s: float = 5.0, debounce_s: float = 0.1, box_every_s: float = 15.0):
        self.state_dir = state_dir or os.path.join(HOME, ".local", "state", "lucky-loop")
        self.sock = sock or os.path.join(HOME, ".config", "herdr", "herdr.sock")
        self.box_host = box_host  # None: no box read (tests); "" never used
        self.heartbeat_s = heartbeat_s
        self.debounce_s = debounce_s
        self.box_every_s = box_every_s
        self.out = os.path.join(self.state_dir, "herdr-live.json")
        self.seen = os.path.join(self.state_dir, "herdr-live.seen.json")
        self.snap_seen = os.path.join(self.state_dir, "herdr-snapshot.seen.json")  # the 60 s snapshot's; read only
        self.log = os.path.join(self.state_dir, "herdr-live.log")
        self.lock = os.path.join(self.state_dir, "herdr-live.lock")


# --------------------------------------------------------------------------------------------- #
# herdr's socket: one JSON request per line, one JSON reply per line (protocol 22).
# --------------------------------------------------------------------------------------------- #
def rpc(sock_path: str, method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 3.0) -> Dict[str, Any]:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(sock_path)
        s.sendall((json.dumps({"id": "herdr-live:" + method, "method": method, "params": params or {}}) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(1 << 16)
            if not chunk:
                break
            buf += chunk
    finally:
        s.close()
    d = json.loads(buf.split(b"\n", 1)[0])
    if "error" in d:
        raise RuntimeError(method + " refused")
    return d.get("result") or {}


def sample_mac(sock_path: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    agents = rpc(sock_path, "agent.list").get("agents") or []
    tabs: Dict[str, Any] = {}
    wss: Dict[str, Any] = {}
    try:
        tabs = {t.get("tab_id"): t for t in (rpc(sock_path, "tab.list").get("tabs") or [])}
    except Exception:
        pass
    try:
        wss = {w.get("workspace_id"): w for w in (rpc(sock_path, "workspace.list").get("workspaces") or [])}
    except Exception:
        pass
    return agents, tabs, wss


def sample_box(host: str) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]]:
    """None when the box has no herdr. Raises on ssh failure. stderr is never read into a log."""
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, BOX_CMD],
                       stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25)
    if r.returncode != 0:
        raise RuntimeError("ssh exit %d" % r.returncode)
    if r.stdout.strip() == "NOHERDR":
        return None
    parts = [p.strip() for p in r.stdout.split("\n@@\n")]
    try:
        agents = json.loads(parts[0])["result"]["agents"]
    except Exception:
        raise RuntimeError("herdr not answering on the box")
    tabs: Dict[str, Any] = {}
    wss: Dict[str, Any] = {}
    try:
        tabs = {t.get("tab_id"): t for t in json.loads(parts[1])["result"]["tabs"]}
    except Exception:
        pass
    try:
        wss = {w.get("workspace_id"): w for w in json.loads(parts[2])["result"]["workspaces"]}
    except Exception:
        pass
    return agents, tabs, wss


def title_of(a: Dict[str, Any]) -> Tuple[Optional[str], bool]:
    """(title, withheld). herdr's stripped title drops the spinner glyph; control bytes go too."""
    t = a.get("terminal_title_stripped")
    if t is None:
        t = a.get("terminal_title") or ""
    t = _CTRL_RE.sub("", str(t)).strip()
    if not t:
        return None, False
    if secretish(t):
        return None, True
    return t[:120], False


# --------------------------------------------------------------------------------------------- #
# the producer
# --------------------------------------------------------------------------------------------- #
class Live:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.seq = 0
        self.started = time.time()
        self.seen: Dict[str, Dict[str, Any]] = read_json(cfg.seen) or {}
        snap = read_json(cfg.snap_seen) or {}
        self.snap_seen: Dict[str, Dict[str, Any]] = snap if isinstance(snap, dict) else {}
        self.mac: Dict[str, Any] = {"herdr": "starting", "sampledAt": None, "agents": [], "tabs": {}, "wss": {}}
        self.box: Dict[str, Any] = {"herdr": "pending" if cfg.box_host else "not read",
                                    "sampledAt": None, "agents": [], "tabs": {}, "wss": {}, "error": None}
        self.box_lock = threading.Lock()
        self.box_dirty = threading.Event()
        self.last_core: Optional[str] = None
        self.last_log_state: Dict[str, Any] = {}
        self.stop = threading.Event()

    # ---- logging: counts and errors only, never a title ----
    def log(self, msg: str) -> None:
        try:
            if os.path.exists(self.cfg.log) and os.path.getsize(self.cfg.log) > 512 * 1024:
                os.replace(self.cfg.log, self.cfg.log + ".1")
            with open(self.cfg.log, "a", encoding="utf-8") as f:
                f.write(iso() + " " + msg + "\n")
        except OSError:
            pass

    def log_once(self, key: str, value: Any, msg: str) -> None:
        if self.last_log_state.get(key) != value:
            self.last_log_state[key] = value
            self.log(msg)

    # ---- rows ----
    def _rows(self, host: str, agents: List[Dict[str, Any]], tabs: Dict[str, Any], wss: Dict[str, Any],
              now: float, seen_now: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        rows = []
        for a in agents:
            pane = str(a.get("pane_id") or "")
            if not pane:
                continue
            state = a.get("agent_status") if a.get("agent_status") in STATES else "unknown"
            key = host + "/" + pane
            prev = self.seen.get(key)
            if prev and prev.get("state") == state:
                since, exact = prev.get("since"), bool(prev.get("exact"))
            elif prev:
                since, exact = iso(now), True  # this producer saw the change happen
            else:
                snap = self.snap_seen.get(pane) if host == "mac" else None
                if snap and snap.get("state") == state and snap.get("since"):
                    since, exact = snap["since"], False  # carried from the 60 s snapshot: at least this old
                else:
                    since, exact = iso(now), False  # first sight: at least this old
            seen_now[key] = {"state": state, "since": since, "exact": exact}
            title, withheld = title_of(a)
            ws = wss.get(a.get("workspace_id")) or {}
            tab = tabs.get(a.get("tab_id")) or {}
            sess = a.get("agent_session") or {}
            rows.append({
                "host": host,
                "pane": pane,
                "workspace": a.get("workspace_id"),
                "workspaceLabel": ws.get("label"),
                "workspaceNumber": ws.get("number"),
                "tab": a.get("tab_id"),
                "tabLabel": tab.get("label"),
                "name": a.get("name"),
                "agent": a.get("agent"),
                "state": state,
                "since": since,
                "sinceExact": exact,
                "title": title,
                "titleWithheld": withheld,
                "cwdBase": os.path.basename(str(a.get("cwd") or "").rstrip("/")) or None,
                "session": sess.get("value") if sess.get("kind") == "id" else None,
            })
        rows.sort(key=lambda r: (r["workspaceNumber"] if isinstance(r["workspaceNumber"], int) else 999,
                                 str(r["workspace"]), str(r["tab"]), r["pane"]))
        return rows

    def _doc(self, trigger: str, now: float) -> Tuple[Dict[str, Any], str]:
        seen_now: Dict[str, Dict[str, Any]] = {}
        mac_rows = self._rows("mac", self.mac["agents"], self.mac["tabs"], self.mac["wss"], now, seen_now)
        with self.box_lock:
            box = dict(self.box)
        box_rows = self._rows("box", box["agents"], box["tabs"], box["wss"], now, seen_now)
        # a host that could not be read keeps its last `since` memory, so a blip is not a state change
        for k, v in self.seen.items():
            if k not in seen_now and ((k.startswith("mac/") and self.mac["herdr"] != "running")
                                      or (k.startswith("box/") and box["herdr"] not in ("running", "not running"))):
                seen_now[k] = v
        if seen_now != self.seen:
            self.seen = seen_now
            try:
                write_json(self.cfg.seen, self.seen)
            except OSError:
                pass
        rows = mac_rows + box_rows
        counts = {s: sum(1 for r in rows if r["state"] == s) for s in STATES}
        counts.update({"total": len(rows), "mac": len(mac_rows), "box": len(box_rows)})
        core = {
            "mac": {"herdr": self.mac["herdr"], "error": self.mac.get("error")},
            "box": {"herdr": box["herdr"], "sampledAt": box["sampledAt"], "error": box.get("error"),
                    "everyS": self.cfg.box_every_s if self.cfg.box_host else None},
            "counts": counts,
            "agents": rows,
        }
        key = json.dumps(core, sort_keys=True)
        doc = {"schema": SCHEMA, "sampledAt": self.mac["sampledAt"] or iso(now), "writtenAt": iso(now),
               "seq": self.seq + 1, "trigger": trigger,
               "producer": {"pid": os.getpid(), "startedAt": iso(self.started), "heartbeatS": self.cfg.heartbeat_s,
                            "push": "herdr events (pane.agent_status_changed + pane/tab/workspace lifecycle)"}}
        doc.update(core)
        doc["mac"]["sampledAt"] = self.mac["sampledAt"]
        return doc, key

    def publish(self, trigger: str, force: bool) -> None:
        now = time.time()
        doc, key = self._doc(trigger, now)
        if not force and key == self.last_core:
            return
        self.seq += 1
        doc["seq"] = self.seq
        write_json(self.cfg.out, doc)
        self.last_core = key
        c = doc["counts"]
        self.log_once("counts", (c["mac"], c["box"], self.mac["herdr"], doc["box"]["herdr"]),
                      "counts mac=%d box=%d working=%d blocked=%d idle=%d done=%d unknown=%d (mac herdr %s, box herdr %s)"
                      % (c["mac"], c["box"], c["working"], c["blocked"], c["idle"], c["done"], c["unknown"],
                         self.mac["herdr"], doc["box"]["herdr"]))

    def resample_mac(self) -> Optional[set]:
        """The set of agent panes, or None when herdr is not answering."""
        try:
            agents, tabs, wss = sample_mac(self.cfg.sock)
        except Exception as e:
            self.mac.update({"herdr": "not running", "agents": [], "tabs": {}, "wss": {},
                             "sampledAt": iso(), "error": type(e).__name__})
            self.log_once("mac", "down", "mac herdr not answering: " + type(e).__name__)
            return None
        self.mac.update({"herdr": "running", "agents": agents, "tabs": tabs, "wss": wss,
                         "sampledAt": iso(), "error": None})
        self.log_once("mac", "up", "mac herdr answering")
        return {str(a.get("pane_id")) for a in agents if a.get("pane_id")}

    # ---- the box, on its own thread: an ssh round trip must never delay a Mac event ----
    def box_loop(self) -> None:
        delay = 0.0
        while not self.stop.wait(delay):
            try:
                got = sample_box(self.cfg.box_host)
                with self.box_lock:
                    if got is None:
                        self.box.update({"herdr": "not installed", "agents": [], "tabs": {}, "wss": {}, "error": None})
                    else:
                        self.box.update({"herdr": "running", "agents": got[0], "tabs": got[1], "wss": got[2], "error": None})
                    self.box["sampledAt"] = iso()
                self.log_once("box", "up", "box herdr read ok")
                delay = self.cfg.box_every_s
            except Exception as e:
                msg = str(e) if isinstance(e, RuntimeError) else type(e).__name__
                with self.box_lock:
                    # keep the last rows: they are dated by box.sampledAt, and the page says how old
                    self.box.update({"herdr": "unreachable", "error": msg[:80]})
                self.log_once("box", "down", "box herdr unreadable: " + msg[:80])
                delay = max(self.cfg.box_every_s, 60.0)
            self.box_dirty.set()

    # ---- events ----
    def subscribe(self, panes: set) -> socket.socket:
        subs = [{"type": t} for t in GLOBAL_EVENTS]
        subs += [{"type": "pane.agent_status_changed", "pane_id": p} for p in sorted(panes)]
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect(self.cfg.sock)
        s.sendall((json.dumps({"id": "herdr-live:subscribe", "method": "events.subscribe",
                               "params": {"subscriptions": subs}}) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(1 << 16)
            if not chunk:
                raise ConnectionError("closed during subscribe")
            buf += chunk
        line, rest = buf.split(b"\n", 1)
        reply = json.loads(line)
        if "error" in reply:
            s.close()
            raise RuntimeError("subscribe refused")
        s.settimeout(None)
        self._pending_buf = rest
        return s

    def run(self) -> None:
        if self.cfg.box_host:
            threading.Thread(target=self.box_loop, name="box", daemon=True).start()
        self.log("start pid %d (heartbeat %.0fs, box every %.0fs)" % (os.getpid(), self.cfg.heartbeat_s, self.cfg.box_every_s))
        while not self.stop.is_set():
            panes = self.resample_mac()
            if panes is None:
                self.publish("herdr-down", force=True)
                self._idle(2.0)
                continue
            try:
                ev = self.subscribe(panes)
            except Exception as e:
                self.log_once("sub", "failed", "events.subscribe failed (%s); polling every 1 s instead" % type(e).__name__)
                self.publish("poll", force=False)
                self._idle(1.0)
                continue
            self.log_once("sub", "ok", "subscribed: %d agent panes + %d lifecycle kinds" % (len(panes), len(GLOBAL_EVENTS)))
            self.publish("start", force=True)
            self._pump(ev, panes)
            try:
                ev.close()
            except OSError:
                pass

    def _idle(self, secs: float) -> None:
        end = time.time() + secs
        while not self.stop.is_set() and time.time() < end:
            if self.box_dirty.wait(min(0.25, max(0.0, end - time.time()))):
                self.box_dirty.clear()
                self.publish("box", force=False)

    def _pump(self, ev: socket.socket, panes: set) -> None:
        sel = selectors.DefaultSelector()
        sel.register(ev, selectors.EVENT_READ)
        buf = getattr(self, "_pending_buf", b"")
        due: Optional[float] = time.time() + self.cfg.debounce_s if b"\n" in buf else None
        next_beat = time.time() + self.cfg.heartbeat_s
        try:
            while not self.stop.is_set():
                now = time.time()
                waits = [next_beat - now, 0.25]
                if due is not None:
                    waits.append(due - now)
                for _key, _mask in sel.select(max(0.0, min(waits))):
                    chunk = ev.recv(1 << 16)
                    if not chunk:
                        self.log_once("sub", "eof", "event stream closed by herdr; resubscribing")
                        return
                    buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line.strip() and due is None:
                        due = time.time() + self.cfg.debounce_s
                now = time.time()
                if due is not None and now >= due:
                    due = None
                    got = self.resample_mac()
                    self.publish("event", force=False)
                    if got is None or got != panes:
                        return  # a pane came or went: resubscribe with the new set
                if now >= next_beat:
                    next_beat = now + self.cfg.heartbeat_s
                    got = self.resample_mac()
                    self.publish("heartbeat", force=True)
                    if got is None or got != panes:
                        return
                if self.box_dirty.is_set():
                    self.box_dirty.clear()
                    self.publish("box", force=False)
        except (OSError, ValueError) as e:
            self.log_once("sub", "error", "event stream error (%s); resubscribing" % type(e).__name__)
        finally:
            sel.close()


# --------------------------------------------------------------------------------------------- #
# --once / --check
# --------------------------------------------------------------------------------------------- #
def once(cfg: Config) -> int:
    try:
        agents, _t, _w = sample_mac(cfg.sock)
    except Exception as e:
        print("mac herdr not answering: " + type(e).__name__)
        return 1
    counts = {s: sum(1 for a in agents if (a.get("agent_status") if a.get("agent_status") in STATES else "unknown") == s)
              for s in STATES}
    print("mac herdr now: %d agents · %s" % (len(agents), " · ".join("%d %s" % (n, s) for s, n in counts.items() if n)))
    return 0


def check(cfg: Config) -> int:
    doc = read_json(cfg.out)
    if not isinstance(doc, dict):
        print("no live file at " + cfg.out)
        return 1
    try:
        then = datetime.strptime(doc["sampledAt"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()
        age = time.time() - then
    except Exception:
        age = float("inf")
    try:
        now_n = len(rpc(cfg.sock, "agent.list").get("agents") or [])
    except Exception:
        now_n = None
    c = doc.get("counts") or {}
    fresh = age <= 3 * float((doc.get("producer") or {}).get("heartbeatS") or 5)
    same = now_n is not None and c.get("mac") == now_n
    print("live file sampledAt %s (age %.1f s, %s) · mac %s · box %s (box herdr %s, read %s) · herdr agent.list now: %s · %s"
          % (doc.get("sampledAt"), age, "fresh" if fresh else "STALE", c.get("mac"), c.get("box"),
             (doc.get("box") or {}).get("herdr"), (doc.get("box") or {}).get("sampledAt"),
             now_n if now_n is not None else "herdr not answering", "MATCH" if same else "MISMATCH"))
    return 0 if (fresh and same) else 1


# --------------------------------------------------------------------------------------------- #
# --selftest: a fake herdr on a temp socket
# --------------------------------------------------------------------------------------------- #
class FakeHerdr:
    def __init__(self, path: str):
        self.path = path
        self.agents = [
            {"pane_id": "w1:p1", "workspace_id": "w1", "tab_id": "w1:t1", "agent": "claude", "agent_status": "idle",
             "terminal_title": "* Fix the build", "terminal_title_stripped": "Fix the build", "cwd": "/x/proj-a",
             "agent_session": {"kind": "id", "value": "sess-1"}},
            {"pane_id": "w1:p2", "workspace_id": "w1", "tab_id": "w1:t1", "agent": "claude", "agent_status": "working",
             # 40 hex characters: the shape the secret rule withholds (a key, or a SHA it cannot tell apart)
             "name": "commander", "terminal_title_stripped": "check " + "0123456789abcdef" * 2 + "01234567", "cwd": "/x/proj-a/"},
        ]
        self.subs: List[socket.socket] = []
        self.srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.srv.bind(path)
        self.srv.listen(16)
        self.alive = True
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while self.alive:
            try:
                c, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._client, args=(c,), daemon=True).start()

    def _client(self, c: socket.socket) -> None:
        buf = b""
        while b"\n" not in buf:
            try:
                chunk = c.recv(1 << 16)
            except OSError:
                return
            if not chunk:
                return
            buf += chunk
        req = json.loads(buf.split(b"\n", 1)[0])
        m = req.get("method")
        if m == "events.subscribe":
            c.sendall((json.dumps({"id": req["id"], "result": {"type": "subscription_started"}}) + "\n").encode())
            self.subs.append(c)
            return
        res: Dict[str, Any] = {}
        if m == "agent.list":
            res = {"agents": [dict(a) for a in self.agents]}
        elif m == "tab.list":
            res = {"tabs": [{"tab_id": "w1:t1", "label": "build"}]}
        elif m == "workspace.list":
            res = {"workspaces": [{"workspace_id": "w1", "label": "proj-a", "number": 1}]}
        c.sendall((json.dumps({"id": req["id"], "result": res}) + "\n").encode())
        c.close()

    def emit(self, pane: str, status: str) -> None:
        for a in self.agents:
            if a["pane_id"] == pane:
                a["agent_status"] = status
        line = json.dumps({"event": "pane.agent_status_changed",
                           "data": {"pane_id": pane, "workspace_id": "w1", "agent_status": status}}) + "\n"
        for c in list(self.subs):
            try:
                c.sendall(line.encode())
            except OSError:
                self.subs.remove(c)

    def close(self) -> None:
        self.alive = False
        for c in self.subs:
            try:
                c.close()
            except OSError:
                pass
        self.srv.close()
        try:
            os.unlink(self.path)
        except OSError:
            pass


def selftest() -> int:
    fails = 0

    def ok(cond: bool, name: str) -> None:
        nonlocal fails
        print(("ok   " if cond else "FAIL ") + name)
        fails += 0 if cond else 1

    d = tempfile.mkdtemp(prefix="herdr-live-")
    sock = os.path.join(d, "h.sock")
    fake = FakeHerdr(sock)
    cfg = Config(state_dir=d, sock=sock, box_host=None, heartbeat_s=0.6, debounce_s=0.05)
    live = Live(cfg)
    t = threading.Thread(target=live.run, daemon=True)
    t.start()

    def wait_for(pred, secs: float = 3.0) -> Optional[Dict[str, Any]]:
        end = time.time() + secs
        while time.time() < end:
            doc = read_json(cfg.out)
            if isinstance(doc, dict) and pred(doc):
                return doc
            time.sleep(0.02)
        return None

    doc = wait_for(lambda x: x.get("counts", {}).get("mac") == 2)
    ok(doc is not None, "start: the file lists both fake agents")
    if doc:
        r1 = [r for r in doc["agents"] if r["pane"] == "w1:p1"][0]
        r2 = [r for r in doc["agents"] if r["pane"] == "w1:p2"][0]
        ok(r1["title"] == "Fix the build" and r1["workspaceLabel"] == "proj-a" and r1["tabLabel"] == "build",
           "a row carries its title, workspace label and tab label")
        ok(r1["cwdBase"] == "proj-a" and r1["session"] == "sess-1", "cwd is a basename; the session id rides along")
        ok(r2["title"] is None and r2["titleWithheld"] is True, "a secret-looking title is withheld, not shown")
        ok(r2["name"] == "commander", "a herdr name is kept")
        ok(doc["schema"] == SCHEMA and doc["box"]["herdr"] == "not read", "schema stamped; no box read in a test")
    t0 = time.time()
    fake.emit("w1:p1", "working")
    doc = wait_for(lambda x: any(r["pane"] == "w1:p1" and r["state"] == "working" for r in x.get("agents", [])), 2.0)
    lat = time.time() - t0
    ok(doc is not None and lat < 0.5, "an event reaches the file in %.0f ms (< 500 ms)" % (lat * 1000))
    if doc:
        r1 = [r for r in doc["agents"] if r["pane"] == "w1:p1"][0]
        ok(r1["sinceExact"] is True and doc["counts"]["working"] == 2, "a seen change is exact and counted")
        ok(doc["trigger"] == "event", "the write says an event caused it")
    s1 = (read_json(cfg.out) or {}).get("sampledAt")
    time.sleep(1.0)
    s2 = (read_json(cfg.out) or {}).get("sampledAt")
    ok(bool(s1) and bool(s2) and s2 > s1, "the heartbeat moves sampledAt with no event")
    # a status change WITHOUT an event (missed) is still caught by the heartbeat
    for a in fake.agents:
        if a["pane_id"] == "w1:p2":
            a["agent_status"] = "blocked"
    doc = wait_for(lambda x: any(r["pane"] == "w1:p2" and r["state"] == "blocked" for r in x.get("agents", [])), 2.0)
    ok(doc is not None, "a missed event is caught by the next heartbeat")
    log = open(cfg.log, encoding="utf-8").read() if os.path.exists(cfg.log) else ""
    ok("Fix the build" not in log and "0123456789abcdef" not in log, "the log holds no title")
    fake.close()
    doc = wait_for(lambda x: x.get("mac", {}).get("herdr") == "not running", 4.0)
    ok(doc is not None and doc["counts"]["mac"] == 0, "herdr gone: the file says so, with no stale rows")
    live.stop.set()
    t.join(3.0)
    print("selftest: %d failure(s)" % fails)
    return 1 if fails else 0


def main(argv: List[str]) -> int:
    if "--selftest" in argv:
        return selftest()
    cfg = Config(box_host=os.environ.get("LL_DGX_HOST", "dgx-remote"))
    os.makedirs(cfg.state_dir, exist_ok=True)
    if "--once" in argv:
        return once(cfg)
    if "--check" in argv:
        return check(cfg)
    lockf = open(cfg.lock, "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("another herdr-live holds " + cfg.lock + "; exiting")
        return 0
    Live(cfg).run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

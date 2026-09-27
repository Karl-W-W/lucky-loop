"""Today — the one page. What needs a human, what the agents did, the goals, the box, the board.

Mounted under ``/api/plugins/fleet/`` by ``plugin_api.py`` (which includes this
router), so the Desktop reaches it through the same namespace-scoped ``ctx.rest``.

Built for two readers at once: Karl at a glance, and an agent that needs the
whole state in one call. ``GET /today`` is the JSON; ``GET /today.txt`` is the
same state as a plain-text digest an agent can paste into its context.

Rules, inherited from plugin_api.py and paid for the same way:

* READ-ONLY, except ``answer``. Nothing here starts, stops, closes or sends. Where a
  human action exists it is rendered as a copy-pasteable command. The one exception
  is verb (a) in ``answer_api.py`` beside this file — Karl's own word on one card,
  OFF unless its flag is on; this module only publishes its signed offers.
* Every sampled value carries its sample time. A snapshot without a clock is the
  bug the snapshot was meant to kill.
* "not instrumented" is a state, distinct from zero and from failure. Sections
  that cannot be sampled say so instead of rendering an invented value.
* Nothing is hand-typed on the way through. The needs-you queue is authored by
  people on purpose (it is a queue of decisions), and every other number is
  derived from a file or a unit at request time.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shlex
import statistics
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter()

HOME = Path.home()
BRAIN = HOME / "brain"
QUEUE_FILE = BRAIN / "queue" / "needs-you.json"
NIGHTLY_LOG = BRAIN / "logs" / "nightly-queue.jsonl"
NIGHTLY_DIR = BRAIN / "captures" / "nightly"
DELEG_LOG = BRAIN / "logs" / "delegations.jsonl"
LOG_MD = BRAIN / "log.md"
EVAL_DASH = BRAIN / "dashboards" / "retrieval-eval.md"
INFRA_DASH = BRAIN / "dashboards" / "infra-status.md"
REPO = HOME / "lucky-loop"
LL_RUNS = HOME / "ll-loop" / "out" / "loop-runs.json"
LL_INBOX = HOME / "ll-loop" / "inbox"
CRON_JOBS = HOME / ".hermes" / "cron" / "jobs.json"
CRON_OUT = HOME / ".hermes" / "cron" / "output"
FAIL_LOG = HOME / "logs" / "lucky-loop-failures.log"
TASKS_FILE = BRAIN / "queue" / "tasks.json"
HERDR_SNAP = HOME / ".local" / "state" / "lucky-loop" / "herdr-agents.json"   # written by the Mac every 60 s
ROOMS_FALLBACK = BRAIN / "tools" / "deploy" / "rooms.json"   # the vault's copy, read only when the gateway is not
HERMES_PROFILES = HOME / ".hermes" / "profiles"
USER_UNIT_DIR = HOME / ".config" / "systemd" / "user"
MAC_SNAPSHOT_STALE_S = 180
# The box's user units that ARE this project's agents (name prefix, before .service or @).
# Everything else under ~/.config/systemd/user (other products, model routers, shims)
# stays on the Fleet page's full unit list; here it is a count, not a row — a roster
# that lists every unit on the box is a fleet list wearing a roster's title.
PROJECT_UNITS = ("lucky-loop", "artifact-return", "nightly-queue", "foreman", "decide-listener",
                 "propose", "infra-watch", "needs-you-notify", "hermes-serve", "hermes-gateway",
                 "herdr-server")

# Exit codes of lucky-loop.service, as the unit declares them (SuccessExitStatus=0 2 4).
EXIT_MEANING = {
    0: "a pass ran and its assertion held",
    2: "a pass ran and hit the iteration cap",
    4: "queue empty — nothing to do",
}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _sh(cmd: str, timeout: int = 12) -> str:
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return p.stdout.strip()
    except Exception:
        return ""


def _now_dt() -> datetime:
    return datetime.now(timezone.utc).astimezone()


def _now() -> str:
    return _now_dt().isoformat(timespec="seconds")


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        s = s.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


def _age_s(s: Optional[str]) -> Optional[int]:
    d = _parse_dt(s)
    return None if d is None else int((_now_dt() - d).total_seconds())


def _read_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def _tail_jsonl(p: Path, n: int = 400) -> List[Dict[str, Any]]:
    try:
        lines = p.read_text(encoding="utf-8").splitlines()[-n:]
    except Exception:
        return []
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _rel(p: Path) -> str:
    try:
        return "~/" + str(p.relative_to(HOME))
    except Exception:
        return str(p)


# --------------------------------------------------------------------------- #
# needs you — the queue of things waiting on a human hand
# --------------------------------------------------------------------------- #
def needs_you(checks: Dict[str, Any], nightly_latest: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "sampled_at": _now(),
        "source": _rel(QUEUE_FILE), "updated_at": None, "items": [], "derived": [],
        "done_count": 0, "error": None,
    }
    all_items: List[Dict[str, Any]] = []
    try:
        d = _read_json(QUEUE_FILE)
        out["updated_at"] = d.get("updatedAt")
        all_items = list(d.get("items", []))
    except FileNotFoundError:
        out["error"] = "queue/needs-you.json is absent from the vault on this box"
    except Exception as e:  # pragma: no cover
        out["error"] = f"queue unreadable: {e}"

    open_items = [i for i in all_items if not i.get("done")]
    open_items.sort(key=lambda i: (i.get("priority", 99), i.get("since", "")))
    for i in open_items:
        i["age_days"] = None
        d0 = _parse_dt(i.get("since") + "T00:00:00+00:00") if i.get("since") else None
        if d0:
            i["age_days"] = max(0, (_now_dt() - d0).days)
    out["items"] = open_items
    out["done_count"] = len(all_items) - len(open_items)
    out["all_items"] = all_items

    # Derived items — nobody typed these; they fall out of the data.
    derived: List[Dict[str, Any]] = []
    for f in checks.get("failing", []) or []:
        derived.append({"id": f"check:{f}", "title": f"An infra check is failing: {f}",
                        "why": "infra-watch marked it red at " + str(checks.get("checked_at")),
                        "command": "ssh dgx-remote 'sed -n 1,40p ~/brain/dashboards/infra-status.md'",
                        "kind": "infra"})
    cred_blocked = [j for j, r in nightly_latest.items() if r.get("status") == "blocked-credential"]
    if cred_blocked:
        derived.append({"id": "cred:gmail-oauth",
                        "title": f"Re-authorise the mail credential to unblock {len(cred_blocked)} nightly job(s): "
                                 + ", ".join(sorted(cred_blocked)),
                        "why": "the nightly queue lists them and skips them every night until a human re-issues it",
                        "command": "# see captures/2026-08-11-rotation-runbook.md; drafts-only, never send",
                        "kind": "credential"})
    out["derived"] = derived
    return out


# --------------------------------------------------------------------------- #
# what the agents did
# --------------------------------------------------------------------------- #
_SEC_RE = re.compile(r"^### (\S+) — (.+?)\s*$")
_DELEG_FOOT_RE = re.compile(r"^\[delegated in (\d+)s · session (\S+) · bot (\S+)\]")


def _nightly_results() -> Dict[str, Dict[str, Any]]:
    """Latest result text per job from the two newest nightly capture pages."""
    results: Dict[str, Dict[str, Any]] = {}
    pages = sorted(glob.glob(str(NIGHTLY_DIR / "*-nightly-queue.md")))[-2:]
    for page in pages:
        try:
            lines = Path(page).read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        run_ts = None
        i = 0
        while i < len(lines):
            line = lines[i]
            if line.startswith("## Run "):
                run_ts = line[7:].split(" ")[0]
            m = _SEC_RE.match(line)
            if m:
                job, head = m.group(1), m.group(2)
                body: List[str] = []
                i += 1
                while i < len(lines) and not lines[i].startswith("### ") and not lines[i].startswith("## "):
                    body.append(lines[i])
                    i += 1
                text = "\n".join(body).strip()
                foot = None
                for b in reversed(body):
                    fm = _DELEG_FOOT_RE.match(b.strip())
                    if fm:
                        foot = fm
                        break
                text = re.sub(r"\n---\n\[delegated in .*?\]\s*$", "", text, flags=re.S).strip()
                if head.startswith("ok"):
                    status = "ok"
                elif "BLOCKED" in head:
                    status = "blocked-credential" if "credential" in head else "blocked-nosource"
                else:
                    status = "failed"
                results[job] = {
                    "job": job, "status": status, "head": head, "text": text,
                    "run_ts": run_ts, "page": _rel(Path(page)),
                    "duration_s": int(foot.group(1)) if foot else None,
                    "session": foot.group(2) if foot else None,
                    "bot": foot.group(3) if foot else None,
                }
                continue
            i += 1
    return results


def _nightly_latest_status() -> Dict[str, Dict[str, Any]]:
    latest: Dict[str, Dict[str, Any]] = {}
    for r in _tail_jsonl(NIGHTLY_LOG, 300):
        j = r.get("job")
        if j:
            latest[j] = r  # file is chronological; last write wins
    return latest


def _first_line(text: str, n: int = 160) -> str:
    for ln in (text or "").splitlines():
        s = ln.strip().lstrip("#*- ").strip().replace("**", "").replace("`", "")
        if s:
            return (s[: n - 1] + "…") if len(s) > n else s
    return ""


def loop_state() -> Dict[str, Any]:
    out: Dict[str, Any] = {"sampled_at": _now(), "source": _rel(LL_RUNS)}
    try:
        runs = _read_json(LL_RUNS).get("runs", [])
    except Exception as e:
        runs = []
        out["runs_error"] = f"{type(e).__name__}: {e}"
    doc_types = set()
    last = None
    for r in runs:
        st = r.get("startedAt")
        if st and (last is None or st > last):
            last = st
        for n in r.get("nodes", []) or []:
            if n.get("node") == "perceive":
                dt = (n.get("output") or {}).get("docType")
                if dt:
                    doc_types.add(dt)
    try:
        queue = len([p for p in os.listdir(LL_INBOX) if not p.startswith(".") and (LL_INBOX / p).is_file()])
        done = len(os.listdir(LL_INBOX / ".done")) if (LL_INBOX / ".done").exists() else 0
    except Exception:
        queue, done = None, None
    show = _sh("systemctl --user show lucky-loop.service -p ExecMainStatus -p ExecMainExitTimestamp -p Result "
               "-p ActiveState --no-pager")
    props = dict(l.split("=", 1) for l in show.splitlines() if "=" in l)
    code = int(props["ExecMainStatus"]) if props.get("ExecMainStatus", "").isdigit() else None
    tick_at = None
    if props.get("ExecMainExitTimestamp"):
        d = _sh(f'date -d "{props["ExecMainExitTimestamp"]}" --iso-8601=seconds')
        tick_at = d or props["ExecMainExitTimestamp"]
    timer_active = _sh("systemctl --user is-active lucky-loop.timer") == "active"
    last_fail = ""
    try:
        last_fail = FAIL_LOG.read_text(encoding="utf-8").strip().splitlines()[-1]
    except Exception:
        pass
    passes = len(runs)
    if not timer_active:
        state = "stopped"
    elif code is None:
        state = "unknown"
    elif code == 4 and (queue or 0) == 0:
        state = "idle — starving" if passes else "idle"
    elif code in (0, 2):
        state = "ran"
    else:
        state = "failed"
    return {
        **out,
        "passes": passes,
        "doc_types": sorted(doc_types),
        "last_pass_at": last,
        "last_pass_age_days": (max(0, _age_s(last) // 86400) if _age_s(last) is not None else None),
        "queue_depth": queue,
        "done_count": done,
        "timer_active": timer_active,
        "last_tick_at": tick_at,
        "last_tick_exit": code,
        "last_tick_meaning": EXIT_MEANING.get(code, "unknown exit code") if code is not None else "no tick recorded",
        "last_failure_line": last_fail[:160],
        "state": state,
        "note": ("idle is healthy by design; the loop exits 4 on an empty queue. "
                 "The problem when it is starving is fuel, not health."),
    }


def agents(nightly_results: Dict[str, Dict[str, Any]], nightly_latest: Dict[str, Dict[str, Any]],
           loop: Dict[str, Any]) -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []

    # 1. Nightly queue — one row per job, newest run. Every minute the queue ever
    # logged is remembered, so its own delegations never reappear below as
    # "on demand" rows (the first cut only remembered the latest run per job and
    # three earlier nights leaked through).
    nightly_minutes = set()
    for r in _tail_jsonl(NIGHTLY_LOG, 400):
        t = r.get("t")
        if t:
            nightly_minutes.add(t[:16])
    for job, r in nightly_latest.items():
        t = r.get("t")
        res = nightly_results.get(job, {})
        status = res.get("status") or r.get("status") or "unknown"
        text = res.get("text", "")
        items.append({
            "t": t, "kind": "nightly", "agent": res.get("bot") or "scout", "job": job,
            "status": ("ok" if status == "ok" else "blocked" if status.startswith("blocked") else
                       "failed" if status in ("failed", "error", "stopped") else status),
            "reason": (r.get("detail") or "")[:200] if status.startswith("blocked") else "",
            "summary": _first_line(text) if status == "ok" else "",
            "text": text if status == "ok" else "",
            "duration_s": res.get("duration_s") or r.get("duration_s"),
            "session": res.get("session"),
            "where": res.get("page") or _rel(NIGHTLY_LOG),
        })

    # 2. On-demand delegations (chat), excluding the rows the nightly queue itself produced.
    for r in _tail_jsonl(DELEG_LOG, 60)[-25:]:
        t = r.get("t") or ""
        if t[:16] in nightly_minutes:
            continue
        items.append({
            "t": t, "kind": "delegate", "agent": r.get("bot"), "job": (r.get("task") or "")[:120],
            "status": "ok" if r.get("ok") else "failed",
            "reason": "" if r.get("ok") else f"exit {r.get('exit')}",
            "summary": "", "text": "",
            "duration_s": r.get("duration_s"), "session": r.get("session"),
            "where": _rel(DELEG_LOG),
        })

    # 3. The loop itself — one row, always.
    items.append({
        "t": loop.get("last_tick_at"), "kind": "loop", "agent": "loop", "job": "unattended pass over the inbox",
        "status": ("ok" if loop.get("state") == "ran" else "failed" if loop.get("state") == "failed"
                   else "stopped" if loop.get("state") == "stopped" else "idle"),
        "reason": loop.get("last_tick_meaning", ""),
        "summary": (f"{loop.get('passes')} passes total · queue {loop.get('queue_depth')} · "
                    f"last pass {loop.get('last_pass_age_days')} days ago"
                    if loop.get("passes") is not None else ""),
        "text": "", "duration_s": None, "session": None, "where": _rel(LL_RUNS),
    })

    # 4. Hermes cron jobs — latest output file per job.
    try:
        jobs = _read_json(CRON_JOBS)
        jobs = jobs.get("jobs", jobs) if isinstance(jobs, dict) else jobs
    except Exception:
        jobs = []
    for j in jobs or []:
        jid = j.get("id")
        if not jid:
            continue
        files = sorted(glob.glob(str(CRON_OUT / jid / "*.md")))
        latest_f = files[-1] if files else None
        status_line, size, when = "", 0, None
        if latest_f:
            try:
                raw = Path(latest_f).read_text(encoding="utf-8")
                size = len(raw.encode("utf-8"))
                m = re.search(r"\*\*Status:\*\*\s*(.+)", raw)
                status_line = m.group(1).strip() if m else ""
                m2 = re.search(r"\*\*Run Time:\*\*\s*(\S+ \S+)", raw)
                if m2:
                    when = _sh(f'date -d "{m2.group(1)}" --iso-8601=seconds') or m2.group(1)
            except Exception:
                pass
        quiet = status_line.startswith("silent")
        items.append({
            "t": when, "kind": "cron", "agent": "hermes-cron", "job": j.get("name") or jid,
            "status": "quiet" if quiet else ("ok" if (j.get("last_status") in ("ok", "completed")) else "unknown"),
            "reason": status_line or "no output file yet",
            "summary": "" if quiet else _first_line(raw.split("**Status:**", 1)[-1] if latest_f else ""),
            "text": "", "duration_s": None, "session": None,
            "where": _rel(CRON_OUT / jid), "enabled": bool(j.get("enabled", True)),
            "schedule": ((j.get("schedule") or {}).get("display") if isinstance(j.get("schedule"), dict)
                         else str(j.get("schedule") or "")),
            "size_bytes": size,
        })

    items.sort(key=lambda i: i.get("t") or "", reverse=True)
    failed = [i for i in items if i["status"] == "failed"]
    return {
        "sampled_at": _now(),
        "items": items,
        "failed_count": len(failed),
        "not_here": ("PULSE and SENTINEL are scheduled cloud agents posting to Slack; their runs are not "
                     "observable from this box and are not listed. Absence here is not silence there."),
    }


# --------------------------------------------------------------------------- #
# goals — OKRs from the repo, KPIs derived live where a file or ledger allows it
# --------------------------------------------------------------------------- #
def _queue_latency(queue_all: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Idea-to-action latency, Karl's own KPI, measured on the one place his hand is
    recorded: needs-you items, from `since` to `doneOn`. A first cut measured ledger
    decision->outcome pairs and reported 0.1 days at 100 %, because a clockout writes
    both events in one sitting. That number flattered the work and measured nothing."""
    def day(s: Optional[str]) -> Optional[datetime]:
        return _parse_dt((s or "") + "T00:00:00+00:00") if s else None
    closed: List[float] = []
    open_ages: List[int] = []
    now = _now_dt()
    for i in queue_all:
        d0 = day(i.get("since"))
        if not d0:
            continue
        if i.get("done"):
            d1 = day(i.get("doneOn")) or None
            if d1:
                closed.append(max(0.0, (d1 - d0).total_seconds() / 86400.0))
        else:
            open_ages.append(max(0, (now - d0).days))
    return {
        "median_days": round(statistics.median(closed), 1) if closed else None,
        "n": len(closed),
        "open": len(open_ages),
        "oldest_open_days": max(open_ages) if open_ages else 0,
        "source": _rel(QUEUE_FILE),
    }


def _mrr_last() -> Dict[str, Any]:
    try:
        rows = [l for l in EVAL_DASH.read_text(encoding="utf-8").splitlines()
                if l.startswith("| 20")]
        if not rows:
            return {"mrr5": None, "error": "no dated rows in retrieval-eval.md"}
        cells = [c.strip() for c in rows[-1].strip("|").split("|")]
        return {"mrr5": float(cells[4]), "at": cells[0], "pairs": cells[1], "source": _rel(EVAL_DASH)}
    except Exception as e:
        return {"mrr5": None, "error": f"{type(e).__name__}: {e}"}


def _converged_nights(start: str = "2026-09-08") -> Dict[str, Any]:
    """O3/KR4 — consecutive unattended CONVERGED nights, the definition as code (Karl, 2026-09-10).

    A night N is the window 20:00Z on date N to 08:00Z on date N+1: it holds the nightly queue's
    01:30Z bills feed and the passes it triggers. Night 1 is 2026-09-08 -> 09. For every night from
    night 1 to the last COMPLETED night (window end <= now):
      * no pass finished in the window   -> IDLE: neither counts nor resets (a starving loop is not a
                                            failing loop, and it is not a converging one either);
      * every pass in the window ended with terminationReason == "converged" -> streak + 1;
      * any other termination            -> the streak resets to 0.
    The counter is read from ~/ll-loop/out/loop-runs.json on this host (R3), never typed."""
    try:
        runs = json.loads(LL_RUNS.read_text(encoding="utf-8")).get("runs", [])
    except Exception as e:  # noqa: BLE001
        return {"streak": 0, "idle": 0, "nights": 0, "error": f"{type(e).__name__}: {e}"}
    from datetime import timedelta
    day0 = _parse_dt(start + "T20:00:00+00:00")
    now = _now_dt()
    streak = idle = nights = 0
    last = None
    n = 0
    while True:
        w0 = day0 + timedelta(days=n)
        w1 = w0 + timedelta(hours=12)
        if w1 > now:
            break
        nights += 1
        inside = [r for r in runs if (t := _parse_dt(r.get("finishedAt") or "")) and w0 <= t < w1]
        if not inside:
            idle += 1
        elif all(r.get("terminationReason") == "converged" for r in inside):
            streak += 1
            last = w0.date().isoformat()
        else:
            streak = 0
            last = w0.date().isoformat()
        n += 1
    return {"streak": streak, "idle": idle, "nights": nights, "last_counted": last, "source": _rel(LL_RUNS)}


def goals(loop: Dict[str, Any], queue_all: List[Dict[str, Any]]) -> Dict[str, Any]:
    okrs_path = REPO / "data" / "okrs.json"
    agents_path = REPO / "data" / "agents.json"
    out: Dict[str, Any] = {"sampled_at": _now(), "source": _rel(okrs_path)}
    try:
        data = _read_json(okrs_path)
    except Exception as e:
        return {**out, "error": f"okrs.json unreadable on this box: {e}", "objectives": []}
    # Quoted: an unquoted '|' in the format string is a shell pipe, and the head
    # silently came back empty the first time this ran.
    head = _sh(f"git -C {REPO} log -1 --format='%h|%cI'")
    if "|" in head:
        out["head"], out["committed_at"] = head.split("|", 1)
    behind = _sh(f"git -C {REPO} rev-list --count HEAD..origin/main 2>/dev/null")
    out["checkout_behind_origin"] = int(behind) if behind.isdigit() else None
    out["checkout_note"] = ("this box's checkout; the nightly queue fast-forwards it before delegating, "
                            "so it can trail main by up to a day")

    herald = {"minPasses": 5, "minDocTypes": 3}
    try:
        for a in _read_json(agents_path).get("agents", []):
            if a.get("id") == "herald" and isinstance(a.get("gate"), dict):
                herald = a["gate"]
    except Exception:
        pass

    latency = _queue_latency(queue_all)
    mrr = _mrr_last()
    passes = loop.get("passes") or 0
    ndoc = len(loop.get("doc_types") or [])
    herald_met = passes >= herald["minPasses"] and ndoc >= herald["minDocTypes"]

    # KR derivations, keyed by "<objective>/<kr>". Anything not listed is DECLARED
    # (the number in okrs.json) and rendered with that word next to it.
    q_done = {i.get("id"): bool(i.get("done")) for i in queue_all}
    nights = _converged_nights()
    derive: Dict[str, Dict[str, Any]] = {
        "O2/KR1": {
            "progress": (int(q_done.get("r2-anthropic-key", False)) + int(q_done.get("r3-telegram-token", False))) / 2,
            "live": f"queue: R-2 {'done' if q_done.get('r2-anthropic-key') else 'open'}, "
                    f"R-3 {'done' if q_done.get('r3-telegram-token') else 'open'}",
        },
        "O3/KR2": {
            "progress": round(min(1.0, (min(passes / herald["minPasses"], 1) + min(ndoc / herald["minDocTypes"], 1)) / 2), 2),
            "live": f"{passes}/{herald['minPasses']} passes · {ndoc}/{herald['minDocTypes']} doc types"
                    + (" · gate MET" if herald_met else ""),
        },
        "O3/KR4": {
            "progress": round(min(1.0, nights["streak"] / 7), 2),
            "live": (f"{nights['streak']}/7 consecutive converged nights since 2026-09-08→09 · "
                     f"{nights['idle']} of {nights['nights']} night(s) idle (skipped)"
                     + (f" · last counted {nights['last_counted']}" if nights.get("last_counted") else "")
                     + (f" · {nights['error']}" if nights.get("error") else "")),
        },
        "O4/KR3": {
            "progress": (1.0 if latency["median_days"] is not None and latency["median_days"] <= 7
                         else round(min(1.0, 7 / latency["median_days"]), 2) if latency.get("median_days")
                         else 0),
            "live": ((f"median {latency['median_days']} days over {latency['n']} closed item(s)"
                      if latency.get("median_days") is not None else "nothing closed yet")
                     + f" · {latency['open']} open, oldest {latency['oldest_open_days']} days"),
        },
        "O5/KR2": {
            "progress": (round(min(1.0, max(0.0, (mrr["mrr5"] - 0.422) / (0.50 - 0.422))), 2)
                         if mrr.get("mrr5") is not None else 0),
            "live": f"MRR@5 {mrr.get('mrr5')} at {mrr.get('at')}" if mrr.get("mrr5") is not None else "no eval row",
        },
    }

    objectives = []
    for o in data.get("objectives", []):
        krs = []
        for kr in o.get("keyResults", []):
            key = f"{o.get('id')}/{kr.get('id')}"
            d = derive.get(key)
            krs.append({
                "id": kr.get("id"), "title": kr.get("title"), "note": kr.get("note"),
                "declared": kr.get("progress", 0),
                "progress": d["progress"] if d else kr.get("progress", 0),
                "derived": bool(d), "live": d["live"] if d else None,
            })
        prog = round(sum(k["progress"] for k in krs) / len(krs), 2) if krs else 0
        due = _parse_dt((o.get("due") or "") + "T23:59:59+00:00") if o.get("due") else None
        days_left = (due - _now_dt()).days if due else None
        if o.get("metOn"):
            state = "met"
        elif prog >= 1:
            state = "met"
        elif days_left is not None and days_left < 0:
            state = "overdue"
        elif days_left == 0:
            state = "due-today"
        else:
            state = "ahead"
        objectives.append({
            "id": o.get("id"), "title": o.get("title"), "due": o.get("due"), "metOn": o.get("metOn"),
            "progress": prog, "state": state, "days_left": days_left, "keyResults": krs,
        })
    return {
        **out,
        "objectives": objectives,
        "live": {
            "passes": passes, "doc_types": loop.get("doc_types"), "last_pass_at": loop.get("last_pass_at"),
            "queue_depth": loop.get("queue_depth"), "herald_gate": {**herald, "met": herald_met},
            "latency": latency, "retrieval": mrr,
        },
    }


# --------------------------------------------------------------------------- #
# the box — one line, derived from the same sources the Fleet sections use
# --------------------------------------------------------------------------- #
def _checks_snapshot() -> Dict[str, Any]:
    if not INFRA_DASH.exists():
        return {"state": "missing", "status": None, "failing": [], "total": 0, "checked_at": None}
    try:
        raw = INFRA_DASH.read_text(encoding="utf-8")
        m = re.search(r"```json\s*(\{.*?\})\s*```", raw, re.S)
        data = json.loads(m.group(1)) if m else {}
    except Exception:
        return {"state": "unparseable", "status": None, "failing": [], "total": 0, "checked_at": None}
    checked_at = data.get("checked_at")
    age = _age_s(checked_at)
    state = "fresh" if age is not None and age <= 1800 else "late" if age is not None and age <= 2700 else "stale"
    return {"state": state, "status": data.get("status"), "failing": data.get("failing", []),
            "total": len(data.get("checks", {})), "checked_at": checked_at, "age_s": age}


def box(checks: Dict[str, Any]) -> Dict[str, Any]:
    try:
        load1 = float(open("/proc/loadavg").read().split()[0])
    except Exception:
        load1 = None
    hottest = None
    for z in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
        try:
            t = int(open(z).read().strip()) / 1000.0
            hottest = t if hottest is None or t > hottest else hottest
        except Exception:
            continue
    g = _sh("nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits")
    gpu_util = gpu_temp = None
    if g and "," in g:
        try:
            gpu_util, gpu_temp = [float(x.strip()) for x in g.split(",")[:2]]
        except Exception:
            pass
    failed_units = [l.split()[0] for l in
                    _sh("systemctl --user --failed --no-legend --plain").splitlines() if l.split()]
    timers = len([l for l in _sh("systemctl --user list-timers --all --no-legend --plain").splitlines() if l.strip()])
    ok = (checks.get("state") == "fresh" and not checks.get("failing")
          and (load1 is None or load1 < 4) and (hottest is None or hottest < 80))
    try:
        import shutil
        du = shutil.disk_usage("/")
        disk_pct = round(du.used / du.total * 100)
    except Exception:
        disk_pct = None
    try:
        uptime_s = int(float(open("/proc/uptime").read().split()[0]))
    except Exception:
        uptime_s = None
    return {
        "sampled_at": _now(),
        "host": os.uname().nodename,
        "disk_pct": disk_pct,
        "uptime_s": uptime_s,
        "ok": ok,
        "load1": load1,
        "hottest_c": round(hottest, 1) if hottest is not None else None,
        "hottest_note": "thermal_zone0 is a max() rollup of the hottest core, not a package temperature",
        "gpu_util_pct": gpu_util,
        "gpu_temp_c": gpu_temp,
        "checks": checks,
        "failed_units": failed_units,
        "timers": timers,
    }


# --------------------------------------------------------------------------- #
# the digest — one string for an agent's context window
# --------------------------------------------------------------------------- #
def board() -> Dict[str, Any]:
    """The task board: ``queue/tasks.json`` in the vault on this box, rendered as it is.

    Agents claim and build here; a verifier that is not the builder writes the
    verdict; Karl reads it (added 2026-09-15 on his word: "put the board on the
    Today page"). Nothing is derived — every field is the file's own — except
    the sort: work in flight first (claimed, open, blocked), then the verified
    rows folded away. The vault branch this box has checked out is shown beside
    the source, because a board read off a task branch is not the board on
    ``master`` (the 09-11..09-15 stranding).
    """
    out: Dict[str, Any] = {"sampled_at": _now(), "source": _rel(TASKS_FILE), "items": [], "counts": {}}
    try:
        data = _read_json(TASKS_FILE)
    except Exception as e:
        return {**out, "error": f"queue/tasks.json unreadable on this box: {e}"}
    branch = _sh(f"git -C {BRAIN} branch --show-current")
    out["vault_branch"] = branch or None
    tasks = data.get("tasks", []) if isinstance(data, dict) else []
    order = {"claimed": 0, "open": 1, "blocked": 2, "rejected": 3, "verified": 4, "converged": 4, "done": 5}
    rows: List[Dict[str, Any]] = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        st = str(t.get("status") or "?")
        pr = t.get("priority")
        rows.append({
            "id": t.get("id"),
            "project": t.get("project"),
            "host": t.get("host"),
            "priority": pr,
            "status": st,
            "owner": t.get("owner") or None,
            "claimed_at": t.get("claimedAt") or None,
            "since": t.get("since"),
            "attempts": t.get("attempts"),
            "title": _first_line(str(t.get("title") or ""), 120),
            "verdict": _first_line(str(t.get("verdict") or ""), 160) or None,
            "not_before": t.get("not_before") or t.get("notBefore") or None,
        })
    rows.sort(key=lambda r: (order.get(r["status"], 9),
                             r["priority"] if isinstance(r["priority"], int) else 9,
                             str(r["since"] or "")))
    counts: Dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    out["items"] = rows
    out["counts"] = counts
    out["in_flight"] = sum(v for k, v in counts.items() if k in ("claimed", "open", "blocked"))
    out["note"] = ("Read-only. Agents claim and build; a verifier that is not the builder writes the verdict; "
                   "only the file changes the board. Source: queue/tasks.json in the vault on this box"
                   + (f", branch {branch}" if branch else "") + ".")
    return out


def _age_str(s: Optional[int]) -> str:
    if s is None:
        return "never"
    if s < 90:
        return f"{s}s ago"
    if s < 5400:
        return f"{round(s / 60)}m ago"
    if s < 172800:
        return f"{round(s / 3600)}h ago"
    return f"{round(s / 86400)}d ago"


def _sysd_ts(s: Optional[str]) -> Optional[str]:
    """``systemctl show --timestamp=utc`` prints ``Wed 2026-09-16 15:40:01 UTC`` for service
    stamps — but a timer's ``LastTriggerUSec``/``NextElapseUSecRealtime`` ignore the flag and
    print the box's LOCAL zone (``... 17:50:01 CEST``, observed on systemd 255). Both are
    accepted; the local form is converted through the box's own zone. Empty when unset."""
    if not s or s.strip() in ("", "n/a", "0"):
        return None
    s = s.strip()
    try:
        return (datetime.strptime(s, "%a %Y-%m-%d %H:%M:%S UTC")
                .replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"))
    except Exception:
        pass
    try:
        naive = datetime.strptime(" ".join(s.split()[:3]), "%a %Y-%m-%d %H:%M:%S")
        return naive.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")   # naive = local
    except Exception:
        return None


def agents_now() -> Dict[str, Any]:
    """AGENTS NOW — one roster (Karl's plan 2026-09-16, L3; council Q2 move 2).

    Two populations, merged into one list because the question is one question
    ("who is working right now?"):

    (a) the Mac's interactive agents — herdr panes — as the Mac itself reports
        them every 60 s into ``~/.local/state/lucky-loop/herdr-agents.json`` on
        this box (``scripts/herdr-snapshot.sh`` in the repo). SHAPE ONLY crosses:
        name, pane, workspace, state, cwd basename, since. The snapshot carries
        its own ``syncedAt`` and is flagged STALE past 3 minutes; an empty list
        with ``note: herdr not running`` is a state, not an error.
    (b) this box's own agents — the user units whose unit file lives under
        ``~/.config/systemd/user`` (the project's, not the distro's), with the
        timer that drives each, sampled at request time from systemd. State is
        systemd's word; "last output" is the last time the main process exited
        (or, for a long-running unit, when it entered active).

    Nothing here starts, stops or attaches. For a Mac row the copy text is
    ``herdr agent attach <name>``; a box row carries the unit's status command.
    """
    out: Dict[str, Any] = {"sampled_at": _now(), "rows": [], "count_mac": 0, "count_box": 0}
    rows: List[Dict[str, Any]] = []

    # (a) the Mac snapshot
    mac: Dict[str, Any] = {"source": _rel(HERDR_SNAP), "synced_at": None, "age_s": None,
                           "stale": True, "stale_after_s": MAC_SNAPSHOT_STALE_S, "note": None}
    try:
        snap = _read_json(HERDR_SNAP)
        mac["synced_at"] = snap.get("syncedAt")
        mac["age_s"] = _age_s(snap.get("syncedAt"))
        mac["stale"] = mac["age_s"] is None or mac["age_s"] > MAC_SNAPSHOT_STALE_S
        mac["note"] = snap.get("note")
        for a in snap.get("agents", []) or []:
            name = str(a.get("name") or a.get("pane") or "?")
            rows.append({
                "name": name, "host": "mac", "state": a.get("state") or "unknown",
                "where": a.get("pane"), "detail": a.get("cwd_base"),
                "since": a.get("since"), "last_output": None, "next": None,
                "attach": f"herdr agent attach {name}",
            })
    except FileNotFoundError:
        mac["error"] = "no Mac snapshot on this box yet (the Mac writes it every 60 s while it is awake)"
    except Exception as e:
        mac["error"] = f"Mac snapshot unreadable: {type(e).__name__}"
    out["mac"] = mac
    out["count_mac"] = len(rows)

    # (b) this box's units
    box: Dict[str, Any] = {"source": _rel(USER_UNIT_DIR), "sampled_at": _now()}
    try:
        def _listed(kind: str) -> List[str]:
            return [l.split()[0] for l in
                    _sh(f"systemctl --user list-units --type={kind} --all --no-legend --plain").splitlines()
                    if l.split() and l.split()[0].endswith("." + kind) and "@." not in l.split()[0]]
        services, timers = _listed("service"), _listed("timer")
        props = ("Id ActiveState SubState UnitFileState FragmentPath Description "
                 "ExecMainExitTimestamp ActiveEnterTimestamp")
        recs: Dict[str, Dict[str, str]] = {}
        raw = _sh("systemctl --user show --timestamp=utc "
                  f"{' '.join('-p ' + p for p in props.split())} {' '.join(services)}", timeout=25)
        for block in raw.split("\n\n"):
            rec = dict(l.split("=", 1) for l in block.splitlines() if "=" in l)
            if rec.get("Id"):
                recs[rec["Id"]] = rec
        tmap: Dict[str, Dict[str, Optional[str]]] = {}
        if timers:
            traw = _sh("systemctl --user show --timestamp=utc -p Id -p Unit -p LastTriggerUSec "
                       f"-p NextElapseUSecRealtime {' '.join(timers)}", timeout=25)
            for block in traw.split("\n\n"):
                rec = dict(l.split("=", 1) for l in block.splitlines() if "=" in l)
                if rec.get("Unit"):
                    tmap[rec["Unit"]] = {"last": _sysd_ts(rec.get("LastTriggerUSec")),
                                         "next": _sysd_ts(rec.get("NextElapseUSecRealtime")),
                                         "timer": rec.get("Id")}
        other_units: List[str] = []
        for uid, rec in recs.items():
            if not str(rec.get("FragmentPath", "")).startswith(str(USER_UNIT_DIR)):
                continue   # the distro's user units are not this project's agents
            base = uid[:-len(".service")].split("@", 1)[0]
            if not any(base == p or base.startswith(p + "-") for p in PROJECT_UNITS):
                other_units.append(uid)   # on the box, not of this project — counted, listed on Fleet
                continue
            active, sub = rec.get("ActiveState"), rec.get("SubState")
            timer = tmap.get(uid)
            if rec.get("UnitFileState") == "masked":
                state = "masked"
            elif active in ("active", "activating", "reloading"):
                state = "active"
            elif active == "failed":
                state = "failed"
            else:
                state = "idle" if timer else "inactive"
            exited = _sysd_ts(rec.get("ExecMainExitTimestamp"))
            entered = _sysd_ts(rec.get("ActiveEnterTimestamp"))
            rows.append({
                "name": uid[:-len(".service")], "host": "box", "state": state,
                "where": (timer or {}).get("timer") or None,
                "detail": (rec.get("Description") or "")[:90] + (f" · {sub}" if sub and sub != "dead" else ""),
                "since": entered if state == "active" else None,
                "last_output": exited or entered, "next": (timer or {}).get("next"),
                "attach": None, "status": f"systemctl --user status {uid}",
            })
        box["other_units"] = len(other_units)
        box["other_note"] = (f"{len(other_units)} other user unit(s) on this box are not this project's agents; "
                             "the Fleet page lists every unit." if other_units else "")
    except Exception as e:
        box["error"] = f"units unreadable: {type(e).__name__}: {e}"
    out["box"] = box
    out["count_box"] = sum(1 for r in rows if r["host"] == "box")

    order = {"blocked": 0, "failed": 0, "working": 1, "active": 1, "idle": 2, "done": 3,
             "inactive": 4, "masked": 4, "unknown": 5}
    rows.sort(key=lambda r: (0 if r["host"] == "mac" else 1, order.get(r["state"], 9), r["name"]))
    out["rows"] = rows
    out["note"] = ("Read-only. Mac rows are what the Mac reported at syncedAt (shape only, no titles, "
                   "no paths); box rows are systemd's word at sample time. Attach and status are copy "
                   "text for a human, never run here.")
    return out


# --------------------------------------------------------------------------- #
# live — the call (/live), served: the order, the batches, who is on stage,
# what was answered today with its word and who gave it, the session number.
# --------------------------------------------------------------------------- #
LIVE_BATCH = 5   # clarify's MAX_QUESTIONS; the page asks one batch at a time


def _answer_mod():
    """The ONE answer_api instance (its signing key is per process), shared with plugin_api."""
    m = sys.modules.get("fleet_answer_api")
    if m is None:
        import importlib.util as _ilu
        spec = _ilu.spec_from_file_location("fleet_answer_api", str(Path(__file__).with_name("answer_api.py")))
        m = _ilu.module_from_spec(spec)
        sys.modules["fleet_answer_api"] = m
        spec.loader.exec_module(m)
    return m


def _queue_key(i: Dict[str, Any]):
    """The queue's own order, the same as /live's byQueue: priority, then expiry, then age, then id."""
    p = i.get("priority")
    return (p if isinstance(p, (int, float)) else 99, str(i.get("expiry") or "9999"),
            str(i.get("since") or ""), str(i.get("id")))


def live(all_items: List[Dict[str, Any]], agents_now_d: Dict[str, Any], agents_d: Dict[str, Any],
         queue_updated_at: Optional[str] = None, today: Optional[str] = None) -> Dict[str, Any]:
    """Everything /live used to work out in the browser, plus what the browser could not see.

    * ``order`` / ``batches``: the open, unparked cards in the queue's order, cut in fives.
    * ``agents``: per seat (a card's ``agent``), its hands, parked and expired counts, the
      herdr pane that carries it (60 s Mac snapshot, with the snapshot's age) and its
      newest failed run.
    * ``done_today``: cards closed today WITH ``answer`` and ``doneBy`` — ``needs_you()``
      returns open cards only, so the page could only say "left the queue".
    * ``session``: rule 11's number, answered today ÷ (answered today + open now).
    * ``answer``: verb (a)'s state; signed offers only while its flag is on.
    """
    today = today or _now_dt().date().isoformat()     # the box's local day, as `decide` uses the Mac's
    tomorrow = (datetime.fromisoformat(today) + timedelta(days=1)).date().isoformat()
    open_ = [i for i in all_items if not i.get("done")]
    parked_ = [i for i in open_ if (i.get("parked") or {}).get("until") and str(i["parked"]["until"]) >= today]
    parked_ids = {i.get("id") for i in parked_}
    queue = sorted([i for i in open_ if i.get("id") not in parked_ids], key=_queue_key)
    order = [i.get("id") for i in queue]
    nb = max(1, -(-len(order) // LIVE_BATCH))
    batches = [{"n": k + 1, "of": nb, "ids": order[k * LIVE_BATCH:(k + 1) * LIVE_BATCH]} for k in range(nb)]

    seat = lambda i: i.get("agent") or "no agent yet"
    rows = (agents_now_d or {}).get("rows") or []
    mac = (agents_now_d or {}).get("mac") or {}
    failed = [r for r in (agents_d or {}).get("items") or [] if r.get("status") in ("failed", "stopped")]
    seats = sorted({seat(i) for i in open_})
    agents_out = []
    for s in seats:
        mine = [i for i in queue if seat(i) == s]
        pane = next((r for r in rows if r.get("host") == "mac" and r.get("name") == s), None)
        fr = next((r for r in failed if r.get("agent") == s), None)
        agents_out.append({
            "seat": s,
            "needs_you": len(mine),
            "parked": sum(1 for i in parked_ if seat(i) == s),
            "expired": sum(1 for i in mine if i.get("expiry") and str(i["expiry"]) < today),
            "first": mine[0].get("id") if mine else None,
            "state": (pane or {}).get("state") if pane else "not in a pane",
            "pane": (pane or {}).get("where"),
            "stale": bool(mac.get("stale")) if pane else None,
            "shipped": not any(i.get("agent_shipped") is False for i in open_ if seat(i) == s),
            "failed": {"t": fr.get("t"), "job": fr.get("job")} if fr else None,
        })

    # When a page answer was recorded, its log line holds the time; other paths record only the day.
    answered_at: Dict[str, str] = {}
    try:
        for r in _tail_jsonl(Path(_answer_mod().STATE_DIR) / "log.jsonl", 500):
            if str(r.get("verdict", "")).startswith("recorded") and r.get("id") and r.get("t"):
                answered_at[str(r["id"])] = str(r["t"])
    except Exception:
        pass
    done_today = []
    for i in all_items:
        if i.get("done") and str(i.get("doneOn") or "") == today:
            done_today.append({
                "id": i.get("id"), "title": i.get("title"), "ask": i.get("ask"), "agent": i.get("agent"),
                "tier": i.get("tier"), "doneOn": i.get("doneOn"),
                "answer": i.get("answer"), "by": i.get("doneBy") or None,
                "answeredAt": answered_at.get(str(i.get("id"))),
                "surface": ("page" if str(i.get("doneBy") or "").startswith("karl — page")
                            else "phone" if "ntfy" in str(i.get("doneBy") or "")
                            else "decide" if str(i.get("doneBy") or "").startswith("karl — decide") else None),
            })
    parked_today = [{"id": i.get("id"), "agent": i.get("agent"), "by": (i.get("parked") or {}).get("by"),
                     "until": i["parked"]["until"]}
                    for i in parked_ if (i.get("parked") or {}).get("reason") == "later"
                    and str(i["parked"]["until"]) == tomorrow]

    answered = len(done_today)
    of = answered + len(open_)
    A = _answer_mod()
    on = A.enabled()
    offers = {}
    if on:
        for i in queue:
            o = A.offer(i)
            if o:
                offers[i.get("id")] = o
    return {
        "sampled_at": _now(),
        "source": _rel(QUEUE_FILE),
        "queue_updated_at": queue_updated_at,
        "today": today,
        "batch_size": LIVE_BATCH,
        "order": order,
        "batches": batches,
        "open": len(open_),
        "needs_you": len(queue),
        "parked": len(parked_),
        "agents": agents_out,
        "mac_snapshot": {"synced_at": mac.get("synced_at"), "age_s": mac.get("age_s"), "stale": mac.get("stale")},
        "done_today": done_today,
        "parked_today": parked_today,
        "session": {
            "answered": answered, "of": of, "line": f"{answered}/{of}",
            "basis": "rule 11: cards closed today (doneOn = the box's local day) ÷ (those + every card still "
                     "open, parked included). Equals 'answered ÷ open at clock-in' when no card was filed today.",
        },
        "answer": {
            "enabled": on, "surface": "page", "offers": offers,
            "how": A.HOW_TO_ENABLE,
        },
    }


def _live_digest(lv: Dict[str, Any]) -> str:
    """/live.txt — the call as text for an agent's context window. Never an offer token."""
    L: List[str] = []
    s = lv.get("session") or {}
    L.append(f"LIVE · {lv.get('sampled_at')} · session {s.get('line')} answered today · "
             f"{lv.get('needs_you')} need you · {lv.get('parked')} parked · {lv.get('open')} open"
             + (f" · queue updated {lv['queue_updated_at']}" if lv.get("queue_updated_at") else "")
             + (f" · {lv['error']}" if lv.get("error") else ""))
    L.append("  answer on the page: " + ("ON — a click on /live sends one card's word; `decide <id> <word>` works as before"
                                         if (lv.get("answer") or {}).get("enabled")
                                         else "off — answer with `decide <id> <word>` in a terminal"))
    cards = {i.get("id"): i for i in lv.get("_cards", [])}
    for b in lv.get("batches") or []:
        if not b.get("ids"):
            continue
        L.append(f"BATCH {b['n']} of {b['of']}:")
        for cid in b["ids"]:
            i = cards.get(cid, {})
            L.append(f"  [{i.get('agent') or 'no agent yet'} · p{i.get('priority', '?')} · tier {i.get('tier', '?')}"
                     + (f" · wanted by {i['expiry']}" if i.get("expiry") else "") + f"] {i.get('ask') or i.get('title')}")
            words = [str(o) for o in (i.get("options") or [])]
            L.append(f"     decide {cid} <{'|'.join(words + ['later'])}>")
    L.append(f"AGENTS (Mac snapshot {_age_str((lv.get('mac_snapshot') or {}).get('age_s'))}"
             + (", STALE" if (lv.get("mac_snapshot") or {}).get("stale") else "") + "):")
    for a in lv.get("agents") or []:
        L.append(f"  {a['seat']:<22} {str(a['state']):<14} needs you {a['needs_you']} · parked {a['parked']}"
                 + (f" · {a['expired']} expired" if a.get("expired") else "")
                 + (" · no agent for this seat yet" if not a.get("shipped") else "")
                 + (f" · failed {str(a['failed']['t'])[:16]} {a['failed']['job']}" if a.get("failed") else ""))
    L.append(f"DONE TODAY ({lv.get('today')}): {len(lv.get('done_today') or [])}")
    for d in lv.get("done_today") or []:
        L.append(f"  {d['id']} = {d.get('answer') or '(no word)'}  — {d.get('by') or 'by: not recorded'}")
    for p in lv.get("parked_today") or []:
        L.append(f"  {p['id']} = later  — parked by {p.get('by')} until {p.get('until')}")
    return "\n".join(L)


def _live() -> Dict[str, Any]:
    d = _today()
    return d.get("live") or {"error": "live block missing"}


@router.get("/live")
def live_json() -> Dict[str, Any]:
    lv = dict(_live())
    lv.pop("_cards", None)
    return lv


@router.get("/live.txt", response_class=PlainTextResponse)
def live_txt() -> str:
    return _live_digest(_live())


# --------------------------------------------------------------------------- #
# rooms — the box gateway's hosted rooms (Bot Mode Group Chats), for monitor mode.
# The gateway is the one authority. This module runs inside hermes-serve, the process
# that owns the hosted-room service, so it reads the same store `groups.list` reads
# (gateway.hosted_rooms.list_rooms on default_db_path()). If that import or read fails,
# the vault's tools/deploy/rooms.json is the fallback and says so in `source`. Names are
# the box's, read at request time: nothing here names a room or a Bot.
# --------------------------------------------------------------------------- #
def _bot_titles() -> Dict[str, str]:
    out: Dict[str, str] = {}
    try:
        import yaml  # hermes-serve's venv carries it
    except Exception:
        return out
    for pf in sorted(HERMES_PROFILES.glob("*/profile.yaml")):
        try:
            meta = yaml.safe_load(pf.read_text()) or {}
            bots = (meta.get("ui_meta") or {}).get("hermes-bots")
            if isinstance(bots, dict) and str(bots.get("title") or "").strip():
                out[pf.parent.name] = str(bots["title"]).strip()
        except Exception:
            continue
    return out


def _room_row(room_id: Any, name: Any, members: List[Any]) -> Dict[str, Any]:
    ids = []
    for m in members or []:
        pid = m.get("profile") or m.get("member_id") if isinstance(m, dict) else m
        if pid:
            ids.append(str(pid))
    return {"id": str(room_id), "name": str(name or room_id), "members": ids}


def rooms(_gateway=None, _fallback: Optional[Path] = None) -> Dict[str, Any]:
    """``{source, sampled_at, rooms: [{id, name, members}], bots, driver?, error?}``.
    ``source`` is ``gateway`` (live store), ``rooms.json`` (the vault's copy, fallback) or
    ``none`` (neither could be read: an unknown, not an empty list)."""
    out: Dict[str, Any] = {"sampled_at": _now(), "bots": _bot_titles()}
    errs: List[str] = []
    try:
        if _gateway is None:
            from gateway.hosted_rooms import default_db_path, list_rooms
            listed = list_rooms(default_db_path())
        else:
            listed = _gateway()
        out["source"] = "gateway"
        out["rooms"] = [_room_row(r.get("room_id"), r.get("name"), r.get("members"))
                        for r in listed if r.get("disbanded_at") is None]
        try:
            if _gateway is None:
                from tui_gateway.methods_groups import get_hosted_room_service
                svc = get_hosted_room_service()
                out["driver"] = bool(svc and svc.runtime.status().get("running"))
        except Exception:
            out["driver"] = None
        return out
    except Exception as e:
        errs.append(f"gateway: {type(e).__name__}: {e}")
    fb = _fallback or ROOMS_FALLBACK
    try:
        d = _read_json(fb)
        out["source"] = "rooms.json"
        out["rooms"] = [_room_row(r.get("room_id") or r.get("id"), r.get("name"), r.get("members"))
                        for r in (d.get("rooms") or [])]
        out["file"] = _rel(fb)
        out["error"] = errs[0]
        return out
    except Exception as e:
        errs.append(f"rooms.json: {type(e).__name__}: {e}")
    out.update({"source": "none", "rooms": [], "error": " · ".join(errs)})
    return out


# --------------------------------------------------------------------------- #
# proposals — C's "Proposals — not questions · no count · never applied by silence".
# Each owner's pass report in the vault ends in a "## Next best action" paragraph; that
# paragraph is the proposal. Read-only: nothing here writes, applies or counts. Newest
# first, one per (owner, title). A line that looks like a value or credential drops the
# whole proposal rather than a redacted half of it.
# --------------------------------------------------------------------------- #
COUNCIL_DIR = BRAIN / "captures" / "council"
PROPOSALS_CAP = 12
_NBA_RE = re.compile(r"^#{2,4}\s*next best action\s*:?\s*$", re.I)
_NBA_INLINE_RE = re.compile(r"^\**next best action\**\s*[:—-]\s*(.+)$", re.I)
_FILE_DATE_RE = re.compile(r"^cc-(\d{4}-\d{2}-\d{2})-(.+)\.md$")
_SECRETISH_RE = re.compile(
    r"(-----BEGIN|\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abpr]-|\bAKIA[0-9A-Z]{12,}"
    r"|\bAIza[0-9A-Za-z_-]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.|(?:password|passwd|secret|token|api[_-]?key|bearer)\s*[:=]\s*\S{6,}"
    r"|\b[A-Fa-f0-9]{40,}\b)", re.I)
# a long unbroken mixed-case+digit run (base64-ish key); case-sensitive, and '-' and '/' are
# left out so a card id or a vault path is never mistaken for a value
_KEYISH_RE = re.compile(r"(?<![A-Za-z0-9+_])(?=[A-Za-z0-9+_]*\d)(?=[A-Za-z0-9+_]*[A-Z])(?=[A-Za-z0-9+_]*[a-z])"
                        r"[A-Za-z0-9+_]{40,}={0,2}")


def _secretish(s: str) -> bool:
    return bool(_SECRETISH_RE.search(s) or _KEYISH_RE.search(s))


def _seats() -> List[str]:
    """The seats are data, never code: every card `agent` in the queue, plus every Bot profile."""
    seats: List[str] = []
    try:
        for pf in sorted(HERMES_PROFILES.iterdir()):
            if pf.is_dir() and re.fullmatch(r"[a-z0-9][a-z0-9-]{1,40}", pf.name) and pf.name not in seats:
                seats.append(pf.name)
    except Exception:
        pass
    try:
        for i in _read_json(QUEUE_FILE).get("items", []):
            a = i.get("agent")
            if isinstance(a, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{1,40}", a) and a not in seats:
                seats.append(a)
    except Exception:
        pass
    return seats


def _next_best_action(text: str) -> Optional[str]:
    lines = text.splitlines()
    for k, ln in enumerate(lines):
        s = ln.strip()
        m = _NBA_INLINE_RE.match(s)
        if m:
            return m.group(1).strip()
        if _NBA_RE.match(s):
            body: List[str] = []
            for nxt in lines[k + 1:]:
                t = nxt.strip()
                if t.startswith("#") or t.startswith("---"):
                    break
                if not t:
                    if body:
                        break
                    continue
                body.append(t)
            return " ".join(body).strip() or None
    return None


def _split_title_why(para: str) -> tuple:
    p = re.sub(r"\*\*|__", "", para)
    p = re.sub(r"^[-*]\s+", "", p).strip()
    m = re.match(r"(.+?[.!?])(\s+|$)(.*)", p, re.S)
    title, rest = (m.group(1), m.group(3)) if m else (p, "")
    if len(title) > 160:
        title = title[:157].rstrip() + "…"
    rest = rest.strip()
    if len(rest) > 400:
        rest = rest[:397].rstrip() + "…"
    return title.strip(), rest


_PROPOSALS_CACHE: Dict[str, Any] = {}


def proposals(_dir: Optional[Path] = None, _seats_list: Optional[List[str]] = None,
              cap: int = PROPOSALS_CAP) -> Dict[str, Any]:
    """Cached for 60 s against the report folder's newest write: /today polls every 15 s."""
    if _dir is not None or _seats_list is not None:
        return _proposals(_dir, _seats_list, cap)
    try:
        stamp = max((p.stat().st_mtime for p in COUNCIL_DIR.glob("cc-*.md")), default=0.0)
    except Exception:
        stamp = -1.0
    hit = _PROPOSALS_CACHE.get("v")
    if hit and hit[0] == stamp and time.time() - hit[1] < 60:
        return hit[2]
    out = _proposals(None, None, cap)
    _PROPOSALS_CACHE["v"] = (stamp, time.time(), out)
    return out


def _proposals(_dir: Optional[Path] = None, _seats_list: Optional[List[str]] = None,
               cap: int = PROPOSALS_CAP) -> Dict[str, Any]:
    """``{sampled_at, source, items: [{owner, title, why, about, file, date}], skipped_secretish}``.
    ``about`` is the report's own H1 (which card or pass it is), because a proposal like
    "Karl says done." means nothing without it.
    An empty ``items`` is a valid state: no owner has proposed anything."""
    d = _dir or COUNCIL_DIR
    out: Dict[str, Any] = {"sampled_at": _now(), "source": _rel(d) + "/cc-*-<seat>-*.md", "items": [],
                           "skipped_secretish": 0}
    seats = sorted(_seats_list or _seats(), key=len, reverse=True)   # longest first: big-seat before big
    cands = []
    for p in d.glob("cc-*.md"):
        m = _FILE_DATE_RE.match(p.name)
        if not m:
            continue
        owner = next((s for s in seats if m.group(2) == s or m.group(2).startswith(s + "-")), None)
        if not owner:
            continue
        # A proposal is an owner's own idea from a PASS report. A per-card report's "next best
        # action" is an ask of Karl about that card — a question, and questions live in the queue.
        if "pass" not in m.group(2)[len(owner):]:
            continue
        try:
            mt = p.stat().st_mtime
        except Exception:
            continue
        cands.append((m.group(1), mt, owner, p))
    cands.sort(key=lambda c: (c[0], c[1]), reverse=True)
    seen = set()
    for fdate, _mt, owner, p in cands[:300]:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        para = _next_best_action(text)
        if not para:
            continue
        title, why = _split_title_why(para)
        if not title or re.match(r"(?i)karl\b", title):   # "Karl pastes…" is a question, not a proposal
            continue
        if _secretish(title) or _secretish(why):
            out["skipped_secretish"] += 1
            continue
        key = (owner, re.sub(r"\W+", " ", title.lower()).strip())
        if key in seen:
            continue
        seen.add(key)
        fm = re.search(r"^date:\s*(\d{4}-\d{2}-\d{2})\s*$", text[:600], re.M)
        h1 = re.search(r"^# (.+?)\s*$", text, re.M)
        about = re.sub(r"\*\*|`", "", h1.group(1)).strip()[:140] if h1 else None
        if about and _secretish(about):
            about = None
        out["items"].append({"owner": owner, "title": title, "why": why, "about": about, "file": _rel(p),
                             "date": fm.group(1) if fm else fdate})
        if len(out["items"]) >= cap:
            break
    return out


# --------------------------------------------------------------------------- #
# models — the box tile's model line: what ollama holds in memory, what it has on disk,
# and the Hermes install. Every field fails soft into ``errors[field]``; nothing raises.
# --------------------------------------------------------------------------- #
OLLAMA = "http://127.0.0.1:11434"
HERMES_BIN = HOME / ".local" / "bin" / "hermes"
HERMES_SKILLS = HOME / ".hermes" / "skills"
_HERMES_CACHE: Dict[str, Any] = {}


def _ollama_get(path: str) -> Any:
    import urllib.request
    with urllib.request.urlopen(OLLAMA + path, timeout=2) as r:
        return json.loads(r.read().decode("utf-8"))


def _hermes_info() -> Dict[str, Any]:
    now = _now_dt().timestamp()
    if _HERMES_CACHE.get("t") and now - _HERMES_CACHE["t"] < 300:
        return dict(_HERMES_CACHE["v"])
    h: Dict[str, Any] = {"version": None, "skills": None}
    try:
        raw = _sh(f"{HERMES_BIN} --version", timeout=5)
        m = re.search(r"v(\d+\.\d+\.\d+)(?:\s*\(([^)]+)\))?", raw)
        if not m:
            raise ValueError("no version in `hermes --version`")
        h["version"] = m.group(1) + (f" ({m.group(2)})" if m.group(2) else "")
    except Exception as e:
        h["version_error"] = f"{type(e).__name__}: {e}"
    try:
        h["skills"] = sum(1 for _ in HERMES_SKILLS.rglob("SKILL.md"))
        h["skills_source"] = _rel(HERMES_SKILLS)
    except Exception as e:
        h["skills_error"] = f"{type(e).__name__}: {e}"
    _HERMES_CACHE.update({"t": now, "v": h})
    return dict(h)


def models(_get=None, _hermes=None) -> Dict[str, Any]:
    """``{sampled_at, loaded: [{name, size_gb, vram_gb, until}] | None, on_disk: int | None,
    hermes: {version, skills}, errors: {field: str}}``."""
    get = _get or _ollama_get
    out: Dict[str, Any] = {"sampled_at": _now(), "source": OLLAMA, "loaded": None, "on_disk": None,
                           "hermes": None, "errors": {}}
    try:
        ps = get("/api/ps")
        out["loaded"] = [{"name": m.get("name"),
                          "size_gb": round((m.get("size") or 0) / 1e9, 1),
                          "vram_gb": round((m.get("size_vram") or 0) / 1e9, 1),
                          "until": m.get("expires_at")} for m in (ps.get("models") or [])]
    except Exception as e:
        out["errors"]["loaded"] = f"{type(e).__name__}: {e}"
    try:
        out["on_disk"] = len(get("/api/tags").get("models") or [])
    except Exception as e:
        out["errors"]["on_disk"] = f"{type(e).__name__}: {e}"
    try:
        out["hermes"] = (_hermes or _hermes_info)()
    except Exception as e:
        out["errors"]["hermes"] = f"{type(e).__name__}: {e}"
    return out


# --------------------------------------------------------------------------- #
# bots — the box's Hermes profiles (a profile dir with profile.yaml or config.yaml; a dir
# holding only logs is a leftover, not a profile). ``bot`` is true when the profile carries
# Bot Mode's ui_meta; ``title`` is the same bots map the rooms block publishes.
# --------------------------------------------------------------------------- #
def _profile_meta(pf: Path) -> Dict[str, Any]:
    """profile.yaml's display_name and description (yaml when importable, else a line read)."""
    try:
        raw = pf.read_text(encoding="utf-8")
    except Exception:
        return {}
    try:
        import yaml
        m = yaml.safe_load(raw) or {}
        return {k: str(m[k]).strip() for k in ("display_name", "description") if m.get(k)}
    except Exception:
        pass
    out: Dict[str, Any] = {}
    lines = raw.splitlines()
    for k, ln in enumerate(lines):
        m = re.match(r"^(display_name|description):\s*(.*)$", ln)
        if not m:
            continue
        val = m.group(2)
        for cont in lines[k + 1:]:                       # folded continuation lines
            if cont.startswith("  ") and not re.match(r"^\s*[\w-]+:\s", cont):
                val += " " + cont.strip()
            else:
                break
        out[m.group(1)] = val.strip().strip("'\"").replace("''", "'")
    return out


def _first_sentence(text: str, n: int = 200) -> Optional[str]:
    t = re.sub(r"\s+", " ", re.sub(r"\*\*|`", "", text or "")).strip()
    if not t:
        return None
    m = re.match(r"(.+?[.!?])(\s|$)", t)
    t = m.group(1) if m else t
    return t if len(t) <= n else t[:n - 1].rstrip() + "…"


def _soul_lane(soul: Path) -> Optional[str]:
    """The first prose paragraph of SOUL.md (headings, front matter and list markers skipped)."""
    try:
        lines = soul.read_text(encoding="utf-8", errors="replace").splitlines()[:80]
    except Exception:
        return None
    body: List[str] = []
    in_fm = bool(lines) and lines[0].strip() == "---"
    for ln in lines[1:] if in_fm else lines:
        t = ln.strip()
        if in_fm:
            in_fm = t != "---"
            continue
        if t.startswith("#") or t.startswith(">") or t.startswith("```") or not t:
            if body:
                break
            continue
        body.append(re.sub(r"^[-*]\s+", "", t))
    return _first_sentence(" ".join(body))


def bots(_dir: Optional[Path] = None, _titles: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """``{sampled_at, source, items: [{id, name, lane, kind, bot}]}``.
    ``id`` is the profile dir; ``name`` the Bot title (the rooms block's bots map), else
    profile.yaml's display_name, else the id; ``lane`` one sentence of what it does, from the
    profile's own description, else its SOUL.md, else "" (config.yaml is never read: it can
    hold keys). Nothing here is typed in the
    repo: seats and lanes are the box's. ``bot`` is true for a Bot Mode profile."""
    d = _dir or HERMES_PROFILES
    titles = _bot_titles() if _titles is None else _titles
    out: Dict[str, Any] = {"sampled_at": _now(), "source": _rel(d), "items": []}
    for p in sorted(d.iterdir()):
        if not p.is_dir() or p.name.startswith("."):
            continue
        pf = p / "profile.yaml"
        if not pf.exists() and not (p / "config.yaml").exists():
            continue
        meta = _profile_meta(pf) if pf.exists() else {}
        title = titles.get(p.name)
        lane = _first_sentence(meta.get("description", "")) or _soul_lane(p / "SOUL.md")
        if not lane or _secretish(lane):
            lane = ""
        out["items"].append({"id": p.name, "name": title or meta.get("display_name") or p.name,
                             "lane": lane, "kind": "hermes", "bot": title is not None})
    return out


# --------------------------------------------------------------------------- #
# timers — the box's user timers with their cadence, from one call. /jobs keeps the raw
# `list-timers` lines; this is the parsed form: every (the timer's own spec), next, last.
# --------------------------------------------------------------------------- #
def _usec_iso(v: Any) -> Optional[str]:
    try:
        v = int(v)
        if v <= 0:
            return None
        return datetime.fromtimestamp(v / 1e6, timezone.utc).astimezone().isoformat(timespec="seconds")
    except Exception:
        return None


def _timer_every(calendar: str, monotonic: str) -> Optional[str]:
    """``TimersCalendar={ OnCalendar=*-*-* 03:30:00 ; next_elapse=… }`` -> ``*-*-* 03:30:00``;
    ``TimersMonotonic={ OnUnitActiveUSec=15min ; … }`` -> ``every 15min``. Boot-only
    delays (OnBootUSec/OnStartupUSec) are left out: they fire once, they are not a cadence."""
    parts: List[str] = []
    for m in re.finditer(r"OnCalendar=([^;}]+?)\s*;", calendar or ""):
        parts.append(m.group(1).strip())
    for m in re.finditer(r"On(UnitActive|UnitInactive|Active)USec=([^;}\s]+)", monotonic or ""):
        parts.append(f"every {m.group(2)}")
    return " · ".join(dict.fromkeys(parts)) or None


def _parse_show(raw: str) -> List[Dict[str, str]]:
    blocks, cur = [], {}
    for ln in raw.splitlines():
        if not ln.strip():
            if cur:
                blocks.append(cur)
                cur = {}
            continue
        k, _, v = ln.partition("=")
        cur[k] = (cur[k] + " " + v) if k in cur else v   # a unit may carry several Timers* lines
    if cur:
        blocks.append(cur)
    return blocks


def timers(_list=None, _show=None) -> Dict[str, Any]:
    """``{sampled_at, source, items: [{name, activates, every, next, last, active}]}``, soonest first."""
    out: Dict[str, Any] = {"sampled_at": _now(), "source": "systemctl --user list-timers + show", "items": []}
    raw = _list() if _list else _sh("systemctl --user list-timers --all -o json --no-pager", timeout=10)
    rows = json.loads(raw or "[]")
    names = [r["unit"] for r in rows if str(r.get("unit", "")).endswith(".timer")]
    if not names:
        return out
    props = _show(names) if _show else _sh(
        "systemctl --user show " + " ".join(shlex.quote(n) for n in names)
        + " -p Id -p TimersCalendar -p TimersMonotonic -p ActiveState --no-pager", timeout=10)
    by_id = {b.get("Id"): b for b in _parse_show(props)}
    for r in rows:
        u = r.get("unit")
        if u not in names:
            continue
        b = by_id.get(u, {})
        out["items"].append({"name": u[:-len(".timer")], "activates": r.get("activates"),
                             "every": _timer_every(b.get("TimersCalendar", ""), b.get("TimersMonotonic", "")),
                             "next": _usec_iso(r.get("next")), "last": _usec_iso(r.get("last")),
                             "active": b.get("ActiveState")})
    out["items"].sort(key=lambda i: (i["next"] is None, i["next"] or ""))
    return out


def _digest(d: Dict[str, Any]) -> str:
    L: List[str] = []
    ny, ag, go, bx = d["needs_you"], d["agents"], d["goals"], d["box"]
    L.append(f"TODAY · {d['sampled_at']} · {bx.get('host')}")
    n_open = len(ny.get("items", [])) + len(ny.get("derived", []))
    L.append(f"NEEDS YOU: {n_open} item(s) · sampled {ny.get('sampled_at')}"
             + (f" · queue updated {ny.get('updated_at')}" if ny.get("updated_at") else "")
             + (f" · {ny['error']}" if ny.get("error") else ""))
    for i in ny.get("items", []):
        L.append(f"  {i.get('priority', '?')}. {i.get('title')}  [since {i.get('since')}, {i.get('age_days')} d]")
        if i.get("steps"):
            L.append(f"     do:    {i['steps']}")
        if i.get("command"):
            for k, ln in enumerate(str(i["command"]).splitlines()):
                L.append(f"     {'paste:' if k == 0 else '      '} {ln}")
        if i.get("check"):
            L.append(f"     check: {i['check']}")
    for i in ny.get("derived", []):
        L.append(f"  •  {i.get('title')}  [derived]")
    L.append(f"AGENTS: {len(ag.get('items', []))} row(s), {ag.get('failed_count')} failed · sampled {ag.get('sampled_at')}")
    for i in ag.get("items", [])[:12]:
        line = f"  {str(i.get('t') or '—')[:16]}  {i.get('kind'):<8} {str(i.get('agent') or ''):<10} {str(i.get('job'))[:48]:<48} {i.get('status')}"
        if i.get("duration_s") is not None:
            line += f" {i['duration_s']}s"
        if i.get("summary"):
            line += f"  — {i['summary'][:110]}"
        elif i.get("reason"):
            line += f"  — {i['reason'][:110]}"
        L.append(line)
    L.append(f"  ({ag.get('not_here')})")
    L.append(f"GOALS ({go.get('source')} @ {go.get('head', '?')}) · sampled {go.get('sampled_at')}:")
    for o in go.get("objectives", []):
        L.append(f"  {o['id']} {o['state']:<9} {int(round(o['progress'] * 100)):>3}%  due {o.get('due')}  {o['title']}")
        for k in o.get("keyResults", []):
            tag = "derived" if k["derived"] else "declared"
            L.append(f"      {k['id']} {int(round(k['progress'] * 100)):>3}% [{tag}] {k['title'][:90]}"
                     + (f"  · {k['live']}" if k.get("live") else ""))
    lv = go.get("live", {})
    L.append(f"  live: {lv.get('passes')} passes · doc types {lv.get('doc_types')} · queue {lv.get('queue_depth')} "
             f"· last pass {lv.get('last_pass_at')} · herald gate met={lv.get('herald_gate', {}).get('met')}")
    ck = bx.get("checks", {})
    L.append(f"BOX: {'OK' if bx.get('ok') else 'LOOK'} · sampled {bx.get('sampled_at')} · checks {ck.get('status')} "
             f"{(ck.get('total') or 0) - len(ck.get('failing') or [])}/{ck.get('total')} ({ck.get('state')}, {ck.get('checked_at')}) "
             f"· load {bx.get('load1')} · hottest {bx.get('hottest_c')} °C · GPU {bx.get('gpu_util_pct')} % "
             f"· failed units {len(bx.get('failed_units') or [])} {bx.get('failed_units')} · timers {bx.get('timers')}"
             f" · disk {bx.get('disk_pct')} % · up {(bx.get('uptime_s') or 0) // 86400} d")
    bd = d.get("board") or {}
    L.append(f"BOARD: {len(bd.get('items', []))} task(s) · sampled {bd.get('sampled_at')} · "
             + (" · ".join(f"{k} {v}" for k, v in sorted((bd.get("counts") or {}).items())) or "none")
             + (f" · vault branch {bd['vault_branch']}" if bd.get("vault_branch") else "")
             + (f" · {bd['error']}" if bd.get("error") else ""))
    for r in bd.get("items", []):
        who = (f" {r['owner']}" if r.get("owner") else "") + (f" since {str(r['claimed_at'])[:16]}" if r.get("claimed_at") else "")
        L.append(f"  {r.get('status'):<9} P{r.get('priority', '?')} {str(r.get('host') or '?'):<4} {str(r.get('id'))[:52]:<52}{who}")
        L.append(f"     — {r.get('verdict') or r.get('title')}")
    an = d.get("agents_now") or {}
    mac = an.get("mac") or {}
    L.append(f"AGENTS NOW: {an.get('count_mac', 0)} mac (synced {_age_str(mac.get('age_s'))}"
             + (", STALE" if mac.get("stale") else "") + f") · {an.get('count_box', 0)} box"
             + f" · sampled {an.get('sampled_at')}"
             + (f" · {(an.get('box') or {}).get('other_units')} other units on Fleet"
                if (an.get("box") or {}).get("other_units") else "")
             + (f" · {mac['note']}" if mac.get("note") else "")
             + (f" · {mac['error']}" if mac.get("error") else "")
             + (f" · {an['error']}" if an.get("error") else ""))
    for r in an.get("rows", []):
        stamp = (f"output {_age_str(_age_s(r['last_output']))}" if r.get("last_output")
                 else f"since {_age_str(_age_s(r['since']))}" if r.get("since") else "—")
        L.append(f"  {r.get('host'):<4} {str(r.get('state')):<8} {str(r.get('name'))[:30]:<30} {stamp:<16}"
                 + (f"  {r['attach']}" if r.get("attach") else ""))
    rm = d.get("rooms") or {}
    L.append(f"ROOMS: {len(rm.get('rooms') or [])} · source {rm.get('source')} · sampled {rm.get('sampled_at')}"
             + (f" · driver {'running' if rm['driver'] else 'down'}" if rm.get("driver") is not None else "")
             + (f" · {rm['error']}" if rm.get("error") else ""))
    for r in rm.get("rooms") or []:
        L.append(f"  {r['name']}: " + ", ".join(r["members"]))
    md = bx.get("models") or {}
    if md:
        hm = md.get("hermes") or {}
        L.append("MODELS: loaded " + (", ".join(f"{m['name']} {m['size_gb']} GB" for m in md.get("loaded") or []) or
                                      ("none" if md.get("loaded") is not None else "?"))
                 + f" · on disk {md.get('on_disk') if md.get('on_disk') is not None else '?'}"
                 + f" · hermes {hm.get('version') or '?'} · skills {hm.get('skills') if hm.get('skills') is not None else '?'}"
                 + (" · errors " + "; ".join(f"{k}: {v}" for k, v in md["errors"].items()) if md.get("errors") else "")
                 + (f" · {md['error']}" if md.get("error") else ""))
    pr = d.get("proposals") or {}
    L.append(f"PROPOSALS (not questions · never applied by silence) · sampled {pr.get('sampled_at')}"
             + (f" · {pr['error']}" if pr.get("error") else ""))
    for p in pr.get("items") or []:
        L.append(f"  {p['date']} {p['owner']:<12} {p['title']}" + (f"  [{p['about']}]" if p.get("about") else ""))
    if not (pr.get("items") or pr.get("error")):
        L.append("  (none)")
    bt = d.get("bots") or {}
    L.append(f"BOTS: {len(bt.get('items') or [])}" + (f" · {bt['error']}" if bt.get("error") else ""))
    for b in bt.get("items") or []:
        L.append(f"  {b['id']:<14} {b['name']:<22} {b.get('lane') or '—'}")
    tm = d.get("timers") or {}
    L.append(f"TIMERS: {len(tm.get('items') or [])} · sampled {tm.get('sampled_at')}"
             + (f" · {tm['error']}" if tm.get("error") else ""))
    for t in tm.get("items") or []:
        L.append(f"  {t['name']:<32} {str(t.get('every') or '—'):<28} next {str(t.get('next') or '—')[:16]}")
    return "\n".join(L)


def _today() -> Dict[str, Any]:
    out: Dict[str, Any] = {"sampled_at": _now()}
    checks = _checks_snapshot()
    nightly_latest = _nightly_latest_status()
    nightly_results = _nightly_results()
    for name, fn in (
        ("loop", lambda: loop_state()),
        ("needs_you", lambda: needs_you(checks, nightly_latest)),
    ):
        try:
            out[name] = fn()
        except Exception as e:  # a section fails alone, never the response
            out[name] = {"error": f"{type(e).__name__}: {e}", "items": []}
    for name, fn in (
        ("agents", lambda: agents(nightly_results, nightly_latest, out["loop"])),
        ("goals", lambda: goals(out["loop"], out["needs_you"].get("all_items", []))),
        ("box", lambda: box(checks)),
        ("board", lambda: board()),
        ("agents_now", lambda: agents_now()),
        ("rooms", lambda: rooms()),
        ("proposals", lambda: proposals()),
        ("bots", lambda: bots()),
        ("timers", lambda: timers()),
    ):
        try:
            out[name] = fn()
        except Exception as e:
            out[name] = {"error": f"{type(e).__name__}: {e}"}
    if isinstance(out.get("box"), dict) and "error" not in out["box"]:
        try:
            out["box"]["models"] = models()
        except Exception as e:
            out["box"]["models"] = {"error": f"{type(e).__name__}: {e}"}
    try:
        ny = out["needs_you"]
        out["live"] = live(ny.get("all_items", []), out.get("agents_now") or {}, out.get("agents") or {},
                           ny.get("updated_at"))
        if ny.get("error"):
            out["live"]["error"] = ny["error"]
        out["live"]["_cards"] = [i for i in ny.get("items", [])]
    except Exception as e:
        out["live"] = {"error": f"{type(e).__name__}: {e}"}
    out["needs_you"].pop("all_items", None)
    n_open = len(out["needs_you"].get("items", [])) + len(out["needs_you"].get("derived", []))
    out["verdict"] = {
        "needs_you": n_open,
        "agents_failed": out["agents"].get("failed_count", 0) if isinstance(out.get("agents"), dict) else 0,
        "box_ok": bool(out["box"].get("ok")) if isinstance(out.get("box"), dict) else False,
        "line": (("1 thing needs you." if n_open == 1 else f"{n_open} things need you.") if n_open
                 else "Nothing needs you."),
    }
    try:
        out["text"] = _digest(out)
    except Exception as e:
        out["text"] = f"digest failed: {type(e).__name__}: {e}"
    return out


@router.get("/today")
def today() -> Dict[str, Any]:
    d = _today()
    if isinstance(d.get("live"), dict):
        d["live"] = {k: v for k, v in d["live"].items() if k != "_cards"}
    return d


@router.get("/today.txt", response_class=PlainTextResponse)
def today_txt() -> str:
    return _today().get("text", "")


# --------------------------------------------------------------------------- #
# selftest — the live block against a fixed queue (needs FastAPI importable:
# `uv run --with fastapi python today_api.py --selftest` off the box)
# --------------------------------------------------------------------------- #
def _selftest() -> int:
    fails: List[str] = []

    def ok(cond: bool, name: str) -> None:
        print(("  ok   " if cond else "  FAIL ") + name)
        if not cond:
            fails.append(name)
    import tempfile
    A = _answer_mod()
    with tempfile.TemporaryDirectory() as td:
        A.FLAG_FILE = Path(td) / "flag"
        A.STATE_DIR = Path(td) / "state"
        A.STATE_DIR.mkdir()
        (A.STATE_DIR / "log.jsonl").write_text(json.dumps({"t": "2026-09-27T10:00:00Z", "id": "d1", "verdict": "recorded"}) + "\n")
        items = [
            {"id": f"c{k}", "title": f"Card {k}", "agent": "commander" if k % 2 else "panel", "tier": 1,
             "priority": 1 if k < 3 else 2, "since": f"2026-09-{10 + k:02d}", "options": ["go", "hold"]}
            for k in range(7)]
        items[1]["expiry"] = "2026-09-20"
        items[4]["parked"] = {"by": "karl", "reason": "later", "until": "2026-09-28"}
        items.append({"id": "d1", "title": "Done one", "agent": "commander", "done": True, "doneOn": "2026-09-27",
                      "answer": "merge", "doneBy": "karl — page merge", "tier": 3})
        items.append({"id": "d2", "title": "Done two", "done": True, "doneOn": "2026-09-27", "answer": "go",
                      "doneBy": "karl — decide go"})
        items.append({"id": "d0", "title": "Done before", "done": True, "doneOn": "2026-09-26", "answer": "go"})
        an = {"mac": {"stale": False, "age_s": 30}, "rows": [{"host": "mac", "name": "commander", "state": "working", "where": "p1"}]}
        ag = {"items": [{"agent": "panel", "status": "failed", "t": "2026-09-27T01:30:00Z", "job": "x"}]}
        lv = live(items, an, ag, today="2026-09-27")
        ok(lv["order"][:3] == ["c1", "c0", "c2"], "order: priority, then expiry, then since")
        ok("c4" not in lv["order"] and lv["parked"] == 1, "a card parked until tomorrow is out of the order")
        ok([len(b["ids"]) for b in lv["batches"]] == [5, 1] and lv["batches"][0]["of"] == 2, "batches of five, n of m")
        cm = next(a for a in lv["agents"] if a["seat"] == "commander")
        pn = next(a for a in lv["agents"] if a["seat"] == "panel")
        ok(cm["state"] == "working" and cm["expired"] == 1 and pn["state"] == "not in a pane" and pn["failed"]["job"] == "x",
           "per-agent state from the herdr snapshot and the failed feed")
        ok([(d["id"], d["answer"], d["by"], d["surface"]) for d in lv["done_today"]]
           == [("d1", "merge", "karl — page merge", "page"), ("d2", "go", "karl — decide go", "decide")],
           "done today carries the word and who gave it")
        ok(lv["done_today"][0]["answeredAt"] == "2026-09-27T10:00:00Z" and lv["done_today"][1]["answeredAt"] is None,
           "a page answer carries its time from the answer log; others only their day")
        ok([p["id"] for p in lv["parked_today"]] == ["c4"], "a later today is listed as parked today")
        ok(lv["session"]["line"] == "2/9", "session: answered today / (answered today + open)")
        ok(lv["answer"]["enabled"] is False and lv["answer"]["offers"] == {}, "answer off: no offers")
        A.FLAG_FILE.write_text("on\n")
        lv2 = live(items, an, ag, today="2026-09-27")
        ok(lv2["answer"]["enabled"] and set(lv2["answer"]["offers"]) == set(lv2["order"])
           and sorted(lv2["answer"]["offers"]["c0"]["tokens"]) == ["go", "hold", "later"], "answer on: one offer per card in the order")
        lv2["_cards"] = [i for i in items if not i.get("done")]
        txt = _live_digest(lv2)
        ok("session 2/9" in txt and "decide c1 <go|hold|later>" in txt and "d1 = merge  — karl — page merge" in txt,
           "/live.txt carries the session, the decide lines and the receipts")
        ok(not any(t in txt for o in lv2["answer"]["offers"].values() for t in o["tokens"].values()),
           "/live.txt never carries an offer token")
        ok(live([], {}, {}, today="2026-09-27")["batches"] == [{"n": 1, "of": 1, "ids": []}]
           and live([], {}, {}, today="2026-09-27")["session"]["line"] == "0/0", "an empty queue is a state, not a crash")
    # rooms: the gateway wins; its failure falls back to the vault's file, labelled; neither is "none"
    with tempfile.TemporaryDirectory() as td:
        fb = Path(td) / "rooms.json"
        fb.write_text(json.dumps({"rooms": [{"room_id": "r1", "name": "One", "members": ["a", "b"]}]}))
        g = rooms(_gateway=lambda: [
            {"room_id": "r1", "name": "One", "members": [{"member_id": "a", "profile": "a"}, {"member_id": "b", "profile": "b"}]},
            {"room_id": "r0", "name": "Gone", "members": [], "disbanded_at": 1.0}], _fallback=fb)
        ok(g["source"] == "gateway" and g["rooms"] == [{"id": "r1", "name": "One", "members": ["a", "b"]}],
           "rooms: the gateway's listing, disbanded rooms left out")

        def boom():
            raise RuntimeError("no store")
        f = rooms(_gateway=boom, _fallback=fb)
        ok(f["source"] == "rooms.json" and f["rooms"][0]["members"] == ["a", "b"] and "no store" in f["error"],
           "rooms: gateway down -> the vault's rooms.json, labelled, with the reason")
        n = rooms(_gateway=boom, _fallback=Path(td) / "missing.json")
        ok(n["source"] == "none" and n["rooms"] == [] and "gateway" in n["error"] and "rooms.json" in n["error"],
           "rooms: neither readable -> source none, an unknown with both reasons")
    # proposals: the "Next best action" paragraph per owner report; newest first; one per (owner, title)
    with tempfile.TemporaryDirectory() as td:
        cd = Path(td)
        def rep(name, nba, date=None, heading="## Next best action"):
            (cd / name).write_text(("---\nreport: r\n" + (f"date: {date}\n" if date else "") + "---\n\n# R\n\n"
                                    + f"{heading}\n\n{nba}\n\n## Commands run\n\nx\n"))
        rep("cc-2026-09-26-alpha-pass-1.md", "Do the first thing. Because it unblocks two.")
        rep("cc-2026-09-27-alpha-pass-2.md", "Do the **first** thing. Again, later.")          # same (owner, title): dropped
        rep("cc-2026-09-27-alpha-card-y.md", "Other idea. A card report, not a pass.")
        rep("cc-2026-09-27-beta-pass-9.md", "Karl says done. An ask of Karl is a question.")
        rep("cc-2026-09-27-big-seat-pass-1.md", "Ship the build. The card id `task-blocked-example-card-with-a-long-id-for-the-test` stays.")
        rep("cc-2026-09-27-big-pass.md", "Seat big.")                                           # seat 'big' is not 'big-seat'
        rep("cc-2026-09-27-alpha-pass-leak.md", "Paste token: " + "Zx9" * 8 + " into the box.")
        rep("cc-2026-09-27-alpha-pass-leak2.md", "Use " + "aB3" * 15 + " as the key.")
        rep("cc-2026-09-25-alpha-none.md", "", heading="## Something else")
        rep("cc-2026-09-22-builder.md", "Not a seat.")
        for k, n in enumerate(["cc-2026-09-27-alpha-pass-2.md", "cc-2026-09-27-big-pass.md", "cc-2026-09-27-big-seat-pass-1.md"]):
            os.utime(cd / n, (1_790_000_000 + k, 1_790_000_000 + k))   # same day: the later write first
        rep("cc-2026-09-24-beta-pass-old.md", "An older one. From its front matter.", date="2026-09-20")
        pr = proposals(_dir=cd, _seats_list=["alpha", "big-seat", "big", "beta"])
        ok([(p["owner"], p["title"]) for p in pr["items"]] ==
           [("big-seat", "Ship the build."), ("big", "Seat big."), ("alpha", "Do the first thing."),
            ("beta", "An older one.")],
           "proposals: newest first, one per (owner, title), longest seat wins, non-seats ignored")
        ok(pr["items"][2]["why"] == "Again, later." and pr["items"][2]["file"].endswith("cc-2026-09-27-alpha-pass-2.md")
           and pr["items"][3]["date"] == "2026-09-20" and "long-id-for-the-test" in pr["items"][0]["why"],
           "proposals: the newer report wins a repeat; why, file, date from front matter; a card id is not a key")
        ok(pr["items"][0]["about"] == "R", "proposals: about is the report's H1")
        ok(pr["skipped_secretish"] == 2 and not any("token" in p["title"] for p in pr["items"]),
           "proposals: a value- or key-looking line drops the proposal")
        ok(len(proposals(_dir=cd, _seats_list=["alpha", "big-seat", "big", "beta"], cap=1)["items"]) == 1, "proposals: capped")
        empty = Path(td) / "empty"
        empty.mkdir()
        ok(proposals(_dir=empty, _seats_list=["alpha"])["items"] == [], "proposals: none is an empty list, not an error")
    # models: every field fails soft
    def fake_get(path):
        if path == "/api/ps":
            return {"models": [{"name": "m:1", "size": 2_500_000_000, "size_vram": 2_400_000_000, "expires_at": "x"}]}
        raise OSError("refused")
    md = models(_get=fake_get, _hermes=lambda: {"version": "0.1.0", "skills": 3})
    ok(md["loaded"] == [{"name": "m:1", "size_gb": 2.5, "vram_gb": 2.4, "until": "x"}] and md["on_disk"] is None
       and "refused" in md["errors"]["on_disk"] and md["hermes"]["skills"] == 3, "models: loaded read, on_disk fails soft")
    def boom2(*_a):
        raise RuntimeError("down")
    md2 = models(_get=boom2, _hermes=boom2)
    ok(md2["loaded"] is None and set(md2["errors"]) == {"loaded", "on_disk", "hermes"}, "models: all down -> three errors, no raise")
    # bots: real profiles only; name from the bots map, else display_name; lane from description, else SOUL.md
    with tempfile.TemporaryDirectory() as td:
        pd = Path(td)
        for n, files in (("a", {"profile.yaml": "display_name: Alpha One\ndescription: 'Reads the queue; drafts,\n  never sends. Second.'\n"}),
                         ("b", {"config.yaml": "x: 1\n", "SOUL.md": "# Soul\n\nYou are **B**. You check.\n"}),
                         ("c", {"logs": None}), ("d", {"profile.yaml": "display_name: 'Dee'\n"})):
            (pd / n).mkdir()
            for f, body in files.items():
                (pd / n / f).mkdir() if body is None else (pd / n / f).write_text(body)
        bt = bots(_dir=pd, _titles={"d": "Dee Bot"})
        ok([(b["id"], b["name"], b["lane"], b["kind"], b["bot"]) for b in bt["items"]]
           == [("a", "Alpha One", "Reads the queue; drafts, never sends.", "hermes", False),
               ("b", "b", "You are B.", "hermes", False), ("d", "Dee Bot", "", "hermes", True)],
           "bots: profiles, names, lane from description then SOUL.md, the bot flag")
    # timers: cadence from the timer's own spec
    ok(_timer_every("{ OnCalendar=*-*-* 03:30:00 ; next_elapse=Mon 2026-09-28 03:30:00 CEST }", "") == "*-*-* 03:30:00"
       and _timer_every("", "{ OnUnitActiveUSec=15min ; next_elapse=1h } { OnBootUSec=5min ; next_elapse=5min }") == "every 15min"
       and _timer_every("", "") is None, "timers: OnCalendar and OnUnitActiveSec parsed, boot delay is not a cadence")
    tl = json.dumps([{"unit": "b.timer", "activates": "b.service", "next": 1790544600000000, "last": 0},
                     {"unit": "a.timer", "activates": "a.service", "next": 1790500000000000, "last": 1790400000000000}])
    sh = ("Id=a.timer\nActiveState=active\nTimersMonotonic={ OnUnitActiveUSec=15min ; next_elapse=x }\n"
          "TimersMonotonic={ OnBootUSec=5min ; next_elapse=5min }\n\n"
          "Id=b.timer\nActiveState=active\nTimersCalendar={ OnCalendar=*-*-* *:00/10:00 ; next_elapse=y }\n")
    tm = timers(_list=lambda: tl, _show=lambda names: sh)
    ok([(t["name"], t["every"], t["last"] is None) for t in tm["items"]]
       == [("a", "every 15min", False), ("b", "*-*-* *:00/10:00", True)], "timers: every/next/last, soonest first")
    ok(timers(_list=lambda: "[]")["items"] == [], "timers: none is an empty list")
    print(f"selftest: {'PASS' if not fails else 'FAIL'} — {len(fails)} failure(s)")
    return 0 if not fails else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(_selftest())

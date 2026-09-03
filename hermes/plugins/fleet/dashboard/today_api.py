"""Today — the one page. What needs a human, what the agents did, the goals, the box.

Mounted under ``/api/plugins/fleet/`` by ``plugin_api.py`` (which includes this
router), so the Desktop reaches it through the same namespace-scoped ``ctx.rest``.

Built for two readers at once: Karl at a glance, and an agent that needs the
whole state in one call. ``GET /today`` is the JSON; ``GET /today.txt`` is the
same state as a plain-text digest an agent can paste into its context.

Rules, inherited from plugin_api.py and paid for the same way:

* READ-ONLY. Nothing here starts, stops, closes or sends. Where a human action
  exists it is rendered as a copy-pasteable command.
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
import statistics
import subprocess
from datetime import datetime, timezone
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
    return {
        "sampled_at": _now(),
        "host": os.uname().nodename,
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
def _digest(d: Dict[str, Any]) -> str:
    L: List[str] = []
    ny, ag, go, bx = d["needs_you"], d["agents"], d["goals"], d["box"]
    L.append(f"TODAY · {d['sampled_at']} · {bx.get('host')}")
    n_open = len(ny.get("items", [])) + len(ny.get("derived", []))
    L.append(f"NEEDS YOU: {n_open} item(s)" + (f" · queue updated {ny.get('updated_at')}" if ny.get("updated_at") else "")
             + (f" · {ny['error']}" if ny.get("error") else ""))
    for i in ny.get("items", []):
        L.append(f"  {i.get('priority', '?')}. {i.get('title')}  [since {i.get('since')}, {i.get('age_days')} d]")
        if i.get("command"):
            L.append(f"     $ {i['command']}")
    for i in ny.get("derived", []):
        L.append(f"  •  {i.get('title')}  [derived]")
    L.append(f"AGENTS: {len(ag.get('items', []))} row(s), {ag.get('failed_count')} failed")
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
    L.append(f"GOALS ({go.get('source')} @ {go.get('head', '?')}):")
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
    L.append(f"BOX: {'OK' if bx.get('ok') else 'LOOK'} · checks {ck.get('status')} "
             f"{(ck.get('total') or 0) - len(ck.get('failing') or [])}/{ck.get('total')} ({ck.get('state')}, {ck.get('checked_at')}) "
             f"· load {bx.get('load1')} · hottest {bx.get('hottest_c')} °C · GPU {bx.get('gpu_util_pct')} % "
             f"· failed units {len(bx.get('failed_units') or [])} {bx.get('failed_units')} · timers {bx.get('timers')}")
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
    ):
        try:
            out[name] = fn()
        except Exception as e:
            out[name] = {"error": f"{type(e).__name__}: {e}"}
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
    return _today()


@router.get("/today.txt", response_class=PlainTextResponse)
def today_txt() -> str:
    return _today().get("text", "")

"""Fleet — one whole view of this box: health, unit budgets, checks, roster, jobs.

Mounted at ``/api/plugins/fleet/`` by the dashboard plugin system.

READ-ONLY BY DESIGN. This surface reports; it does not control. That is not a
missing feature — the standing ADR is that Hermes is interface and chat runtime,
never orchestration, and the `/war` precedent is a read-only hub with management
staying on the CLI. Where an action is available it is emitted as a copy-pasteable
command, so the human runs it and can see what they ran.

Honesty rules this module is built to, each learned the expensive way:

* Everything sampled carries ``sampled_at``. A snapshot rendered without its
  sample time is the bug the snapshot was supposed to kill.
* Firmware stubs are NEVER reported as measurements. ``hwmon0/fan1_input`` reads a
  constant 2 and ``hwmon0/power1_input`` reads 5000 uW on this box; both are
  placeholders. They are reported as ``not_instrumented`` instead of numbers.
* ``thermal_zone0`` is a ``max()`` rollup mirroring the hottest core, not a package
  temperature. It is labelled as such so nobody reads a busy core as a hot box.
* Total system power is NOT measurable here (no BMC, empty ``/sys/class/powercap``).
  Only the GPU rail is real, and only that is reported.
* Every number is derived at request time. Nothing is hand-typed.
* A collector that fails returns an ``error`` string for its section rather than
  failing the whole response — a partial view beats a 500, and a section that
  cannot be sampled says so rather than rendering a stale or invented value.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter

router = APIRouter()

HOME = Path.home()
INFRA_DASH = HOME / "brain" / "dashboards" / "infra-status.md"
CPU_STATE = HOME / ".local/state/fleet/cpu-usage.json"

# Units worth showing even when inactive, so a masked runaway stays visible.
SYSTEM_UNITS = [
    "cloudflared.service", "ollama.service", "docker.service", "containerd.service",
    "tailscaled.service", "cron.service", "ssh.service", "squid.service",
]


def _sh(cmd: str, timeout: int = 12) -> str:
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return p.stdout.strip()
    except Exception:
        return ""


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# health
# --------------------------------------------------------------------------- #
def _cpu_snapshot() -> Dict[str, Any]:
    """Box-wide and per-core busy %, from two /proc/stat reads 300ms apart.

    /proc/stat rather than mpstat: no package dependency, and it is the same
    counter mpstat reads.
    """
    def read():
        out = {}
        for line in open("/proc/stat"):
            if line.startswith("cpu"):
                parts = line.split()
                if len(parts) > 8:
                    out[parts[0]] = [int(x) for x in parts[1:9]]
        return out

    a = read()
    time.sleep(0.3)
    b = read()
    res = {}
    for k in a:
        if k not in b:
            continue
        da = b[k][0] - a[k][0]           # user
        dn = b[k][1] - a[k][1]           # nice
        ds = b[k][2] - a[k][2]           # system
        di = b[k][3] - a[k][3]           # idle
        dio = b[k][4] - a[k][4]          # iowait
        total = sum(b[k][i] - a[k][i] for i in range(8))
        if total <= 0:
            continue
        res[k] = {
            "busy_pct": round(100.0 * (total - di - dio) / total, 2),
            "user_pct": round(100.0 * (da + dn) / total, 2),
            "system_pct": round(100.0 * ds / total, 2),
        }
    cores = sorted(
        ({"core": int(k[3:]), **v} for k, v in res.items() if k != "cpu"),
        key=lambda c: c["core"],
    )
    return {"all": res.get("cpu", {}), "cores": cores}


def _thermal() -> List[Dict[str, Any]]:
    zones = []
    for z in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
        try:
            t = int(Path(z, "temp").read_text().strip()) / 1000.0
            name = Path(z, "type").read_text().strip()
        except Exception:
            continue
        zid = os.path.basename(z)
        note = ""
        if zid == "thermal_zone0":
            note = "max() rollup — mirrors the hottest core, NOT a package temperature"
        zones.append({"zone": zid, "type": name, "celsius": round(t, 1), "note": note})
    return zones


def _nvme() -> List[Dict[str, Any]]:
    out = []
    for h in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
        try:
            if Path(h, "name").read_text().strip() != "nvme":
                continue
        except Exception:
            continue
        for i in (1, 2, 3):
            try:
                v = int(Path(h, f"temp{i}_input").read_text().strip()) / 1000.0
            except Exception:
                continue
            lbl = ""
            try:
                lbl = Path(h, f"temp{i}_label").read_text().strip()
            except Exception:
                lbl = f"temp{i}"
            out.append({"label": lbl, "celsius": round(v, 1)})
    return out


def _gpu() -> Dict[str, Any]:
    q = _sh("nvidia-smi --query-gpu=name,temperature.gpu,power.draw,utilization.gpu,"
            "clocks.sm,memory.used --format=csv,noheader,nounits")
    if not q:
        return {"error": "nvidia-smi returned nothing"}
    f = [x.strip() for x in q.split(",")]

    def num(v):
        try:
            return float(v)
        except Exception:
            return None

    apps = []
    for line in _sh("nvidia-smi --query-compute-apps=pid,used_memory "
                    "--format=csv,noheader,nounits").splitlines():
        p = [x.strip() for x in line.split(",")]
        if len(p) == 2 and p[0].isdigit():
            comm = _sh(f"ps -o comm= -p {p[0]}") or "?"
            apps.append({"pid": int(p[0]), "mib": num(p[1]), "comm": comm})
    return {
        "name": f[0] if f else None,
        "temp_c": num(f[1]) if len(f) > 1 else None,
        "power_w": num(f[2]) if len(f) > 2 else None,
        "util_pct": num(f[3]) if len(f) > 3 else None,
        "sm_clock_mhz": num(f[4]) if len(f) > 4 else None,
        "processes": apps,
    }


def _memory() -> Dict[str, Any]:
    m = {}
    try:
        for line in open("/proc/meminfo"):
            k, _, v = line.partition(":")
            m[k] = int(v.split()[0])
    except Exception:
        return {"error": "cannot read /proc/meminfo"}
    mb = lambda k: round(m.get(k, 0) / 1024.0)
    return {
        "total_mb": mb("MemTotal"),
        "available_mb": mb("MemAvailable"),
        "buffcache_mb": mb("Buffers") + mb("Cached"),
        "swap_used_mb": mb("SwapTotal") - mb("SwapFree"),
        "note": ("unified memory: the GPU carveout is charged to no process's RSS, "
                 "so 'used' includes memory no process appears to own"),
    }


@router.get("/health")
def health() -> Dict[str, Any]:
    try:
        la = open("/proc/loadavg").read().split()[:3]
        load = [float(x) for x in la]
    except Exception:
        load = None
    return {
        "sampled_at": _now(),
        "host": os.uname().nodename,
        "uptime_s": int(float(open("/proc/uptime").read().split()[0])),
        "cores": os.cpu_count(),
        "load": load,
        "cpu": _cpu_snapshot(),
        "memory": _memory(),
        "thermal": _thermal(),
        "nvme": _nvme(),
        "gpu": _gpu(),
        "not_instrumented": {
            "fan_rpm": "firmware stub (hwmon0/fan1_input reads a constant)",
            "system_power_w": "no BMC and /sys/class/powercap is empty — unmeasurable",
        },
    }


# --------------------------------------------------------------------------- #
# units + CPU budgets
# --------------------------------------------------------------------------- #
def _show(units: List[str], user: bool) -> Dict[str, Dict[str, str]]:
    if not units:
        return {}
    scope = "--user " if user else ""
    props = ("Id ActiveState SubState UnitFileState NRestarts MemoryCurrent "
             "MemoryPeak CPUUsageNSec ExecMainStartTimestampMonotonic Description")
    raw = _sh(f"systemctl {scope}show {' '.join('-p ' + p for p in props.split())} "
              f"{' '.join(units)}", timeout=25)
    # systemctl emits one record per unit, separated by a BLANK LINE, and orders
    # properties its own way rather than the way they were requested. Keying off a
    # named property as the record terminator therefore misaligns fields across
    # units — an earlier version did exactly that and reported the wrong unit as
    # masked. Split on the blank line instead.
    out: Dict[str, Dict[str, str]] = {}
    for block in raw.split("\n\n"):
        rec: Dict[str, str] = {}
        for line in block.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                rec[k] = v
        uid = rec.get("Id")
        if uid:
            out[uid] = rec
    return out


def _budgets() -> Dict[str, Any]:
    """Per-unit CPU rate since the previous poll — the same method the
    infra-watch cpu:user-unit-burn check uses, and for the same reason: a
    lifetime average understates a unit that is burning a core right now."""
    # list-units omits a masked unit once it is no longer loaded, so the very
    # units an operator just took out of service would vanish from the view that
    # exists to show them. Union it with list-unit-files, which is file-based and
    # keeps masked/disabled units visible.
    ulist = [l.split()[0] for l in
             _sh("systemctl --user list-units --type=service --all --no-legend --plain").splitlines()
             if l.split() and l.split()[0].endswith(".service")]
    # Only the masked set, not every unit file: list-unit-files also returns
    # TEMPLATE units (``foo@.service``), which `systemctl show` rejects outright
    # and which corrupt the whole batched call.
    masked = [l.split()[0] for l in
              _sh("systemctl --user list-unit-files --state=masked --type=service "
                  "--no-legend --plain").splitlines()
              if l.split() and l.split()[0].endswith(".service")]
    ulist = sorted({u for u in set(ulist) | set(masked) if "@." not in u})
    udata = _show(ulist, user=True)
    sdata = _show(SYSTEM_UNITS, user=False)

    now = time.time()
    prev: Dict[str, Any] = {}
    try:
        prev = json.loads(CPU_STATE.read_text())
    except Exception:
        prev = {}
    cur_ns = {}
    for uid, d in list(udata.items()) + list(sdata.items()):
        ns = d.get("CPUUsageNSec", "")
        if ns.isdigit():
            cur_ns[uid] = int(ns)
    try:
        CPU_STATE.parent.mkdir(parents=True, exist_ok=True)
        CPU_STATE.write_text(json.dumps({"t": now, "units": cur_ns}))
    except Exception:
        pass

    pt, pu = prev.get("t"), prev.get("units", {})
    dt = (now - pt) if pt else None

    rows = []
    for scope, data in (("user", udata), ("system", sdata)):
        for uid, d in data.items():
            ns = int(d["CPUUsageNSec"]) if d.get("CPUUsageNSec", "").isdigit() else None
            mem = d.get("MemoryCurrent", "")
            memb = int(mem) if mem.isdigit() else None
            cores = None
            if ns is not None and dt and dt >= 30:
                p = pu.get(uid)
                if p is not None and ns >= p:
                    cores = round((ns - p) / 1e9 / dt, 3)
            rows.append({
                "unit": uid,
                "scope": scope,
                "active": d.get("ActiveState"),
                "sub": d.get("SubState"),
                "file_state": d.get("UnitFileState"),
                "restarts": int(d["NRestarts"]) if d.get("NRestarts", "").isdigit() else 0,
                "cpu_hours": round(ns / 1e9 / 3600, 3) if ns is not None else None,
                "cores_now": cores,
                "mem_mb": round(memb / 1048576) if memb else None,
                "description": d.get("Description", ""),
            })
    rows.sort(key=lambda r: (r["cpu_hours"] is None, -(r["cpu_hours"] or 0)))
    return {
        "sampled_at": _now(),
        "interval_s": round(dt) if dt else None,
        "rate_available": bool(dt and dt >= 30),
        "rate_note": ("cores_now needs two polls at least 30s apart; it is null on the "
                      "first load, which is not a failure"),
        "units": rows,
    }


@router.get("/units")
def units() -> Dict[str, Any]:
    return _budgets()


# --------------------------------------------------------------------------- #
# infra-watch checks
# --------------------------------------------------------------------------- #
@router.get("/checks")
def checks() -> Dict[str, Any]:
    """The 13 infra-watch checks. Written every 15 min by infra-watch.timer.

    Staleness is a first-class state here: the file is a SNAPSHOT, so the view
    must show when it was taken and say plainly when it has stopped moving.
    """
    if not INFRA_DASH.exists():
        return {"error": "infra-status.md absent — infra-watch has never run",
                "state": "missing", "sampled_at": _now()}
    try:
        raw = INFRA_DASH.read_text()
        m = re.search(r"```json\s*(\{.*?\})\s*```", raw, re.S)
        if not m:
            return {"error": "no JSON block in infra-status.md", "state": "unparseable",
                    "sampled_at": _now()}
        data = json.loads(m.group(1))
    except Exception as e:
        return {"error": f"unreadable: {e}", "state": "unparseable", "sampled_at": _now()}

    checked_at = data.get("checked_at")
    age = None
    state = "fresh"
    try:
        dt = datetime.fromisoformat(checked_at)
        age = int((datetime.now(dt.tzinfo) - dt).total_seconds())
        if age > 2700:
            state = "stale"          # >45 min = three missed 15-min runs
        elif age > 1800:
            state = "late"
    except Exception:
        state = "unknown-age"
    ch = data.get("checks", {})
    return {
        "sampled_at": _now(),
        "checked_at": checked_at,
        "age_s": age,
        "state": state,
        "status": data.get("status"),
        "failing": data.get("failing", []),
        "total": len(ch),
        "checks": [{"key": k, **v} for k, v in sorted(ch.items())],
    }


# --------------------------------------------------------------------------- #
# scheduled jobs
# --------------------------------------------------------------------------- #
@router.get("/jobs")
def jobs() -> Dict[str, Any]:
    timers = []
    for scope, flag in (("user", "--user "), ("system", "")):
        raw = _sh(f"systemctl {flag}list-timers --all --no-legend --no-pager", timeout=20)
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            unit = next((p for p in parts if p.endswith(".timer")), None)
            if not unit:
                continue
            timers.append({"kind": "timer", "scope": scope, "name": unit, "raw": line.strip()})

    crons = []
    for line in _sh("crontab -l", timeout=10).splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            if s.startswith("#DISABLED"):
                crons.append({"kind": "cron", "name": s[:60], "schedule": "",
                              "command": "", "state": "disabled"})
            continue
        parts = s.split(None, 5)
        if len(parts) >= 6:
            crons.append({
                "kind": "cron",
                "schedule": " ".join(parts[:5]),
                "command": parts[5][:200],
                "state": "enabled",
                # named so the view can call out the ungated auto-deploy
                "flag": ("ungated auto-deploy into a live system"
                         if "reset --hard" in parts[5] else ""),
            })
    return {"sampled_at": _now(), "timers": timers, "cron": crons}


# --------------------------------------------------------------------------- #
# roster
# --------------------------------------------------------------------------- #
@router.get("/roster")
def roster() -> Dict[str, Any]:
    """Units and Hermes sessions. Two populations, deliberately distinguished:
    systemd units are GOVERNED (their state is authoritative); sessions are
    OBSERVED. Where last-activity cannot be derived it is reported as null, not
    as 'inactive' — uninstrumented is not failed."""
    b = _budgets()
    agents = []
    for r in b["units"]:
        masked = r["file_state"] == "masked"
        agents.append({
            "name": r["unit"].replace(".service", ""),
            "scope": r["scope"],
            "state": ("masked" if masked else r["active"]),
            "detail": ("masked — cannot be started, supervisors will fail"
                       if masked else r["sub"] or ""),
            "cpu_hours": r["cpu_hours"],
            "cores_now": r["cores_now"],
            "mem_mb": r["mem_mb"],
            "restarts": r["restarts"],
            "description": r["description"],
            "control": ("systemctl --user unmask " + r["unit"] if masked else
                        ("systemctl --user stop " + r["unit"] if r["scope"] == "user"
                         else "sudo systemctl stop " + r["unit"])),
            "control_needs_root": r["scope"] != "user",
        })

    sessions = []
    sdir = HOME / ".hermes" / "sessions"
    try:
        if sdir.exists():
            for p in sorted(sdir.glob("*"), key=lambda x: x.stat().st_mtime, reverse=True)[:15]:
                sessions.append({
                    "name": p.name,
                    "last_activity": datetime.fromtimestamp(
                        p.stat().st_mtime, timezone.utc).astimezone().isoformat(timespec="seconds"),
                })
    except Exception:
        pass
    return {"sampled_at": _now(), "agents": agents, "sessions": sessions,
            "sessions_note": ("sessions are OBSERVED, not governed; an empty list means "
                              "none were found on disk, not that none ran")}


# --------------------------------------------------------------------------- #
# overview — one call for the whole view
# --------------------------------------------------------------------------- #
@router.get("/overview")
def overview() -> Dict[str, Any]:
    out: Dict[str, Any] = {"sampled_at": _now(),
                           "maturity": ("Lucky Loop is an early MVP and is not finished. "
                                        "This view reports what is measured on one box; "
                                        "where something is not instrumented it says so.")}
    for name, fn in (("health", health), ("units", _budgets), ("checks", checks),
                     ("jobs", jobs), ("roster", roster)):
        try:
            out[name] = fn()
        except Exception as e:            # a section fails alone, never the response
            out[name] = {"error": f"{type(e).__name__}: {e}"}
    return out


# --------------------------------------------------------------------------- #
# today — the one page (what needs a human, what the agents did, goals, the box)
# lives in today_api.py beside this file and is mounted under the same prefix.
# --------------------------------------------------------------------------- #
try:
    import importlib.util as _ilu
    _spec = _ilu.spec_from_file_location("fleet_today_api", str(Path(__file__).with_name("today_api.py")))
    _today_mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_today_mod)
    router.include_router(_today_mod.router)
except Exception as _e:  # never take the Fleet routes down with it
    @router.get("/today")
    def _today_unavailable() -> Dict[str, Any]:
        return {"error": f"today_api failed to load: {type(_e).__name__}: {_e}", "sampled_at": _now()}

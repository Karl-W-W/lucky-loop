#!/usr/bin/env python3
"""artifact-return — the loop host's half of the artifact-return hop (Karl's word 2026-09-10: action).

Until 2026-09-10 the loop's artifacts reached the public repo through a launchd job on the Mac
(deploy/loop-publish.sh). A closed lid stopped the hop and nothing watched it — the council's
dissent. Karl's word moved the hop off the Mac, overriding the chair's `mac`, and this file is the
box side of that move.

This host may NOT publish publicly (rule dgx-credential-purpose-2026-09-08, and Rule 3: nothing
outward without Karl's hand). So it does not. It stages the three artifacts plus a gate attestation
in a dedicated PRIVATE mirror repo over a write deploy key scoped to that one repo, and
.github/workflows/artifact-return.yml in the public repo pulls them from there, re-runs the gates it
can run, regenerates the canvas and opens a PR. A human merges the PR; the merge is the publication.
Nothing here touches the public repo.

The council's conditions (captures/council/council-artifact-hop-off-the-mac.md), as code:
  * the mirror holds ONLY the redacted files: four fixed filenames; any other path in the mirror's
    working tree refuses the push instead of being swept along;
  * no content in logs: one line per run, counts and verdict words only, never a filename, never
    a document title;
  * gate.json is written HERE — {gate, nameTokens, sha256, at} — and says "strong" only when the real
    deny-list was loaded AND had content (redact.py's fail-closed test), the redaction gate and its
    tests exited 0. The Action refuses when the file is absent, weak, older than the newest pass or
    when a sha256 differs. It is an attestation by the host that wrote the artifact, not an
    independent check, and the Action labels it that way;
  * the run-count floor is enforced twice: here against the mirror's last copy and in the Action
    against the committed copy. Published history never shrinks on the word of one host;
  * the trigger is a content hash on a timer, not inotify: out/loop-runs.json was once touched with
    no pass behind it (RISK, 2026-09-08). Idempotent like loop-publish.sh was: stage on a new pass,
    or when the mirror's status snapshot is older than STATUS_MAX_AGE_H.

Runs from a dedicated clone of the public repo (~/lucky-loop-gate) that is reset to origin/main
on every run, so the gate code is always the published one — and the foreman's working checkout
is never reset under a worker.

Usage, on the loop host:
    python3 deploy/artifact-return/artifact-return.py             # stage if there is something to stage
    python3 deploy/artifact-return/artifact-return.py --dry-run   # everything but commit and push
One line per run in ~/.local/state/lucky-loop/artifact-return.log:
    <utc> passes=<n> new=<k> gate=<strong|weak|red|skipped> tokens=<n> pushed=<yes|no> reason=<why>
Exit 0 = staged or nothing to do; 1 = refused (a red gate, a shrinking host, a foreign path in the
mirror) — the unit's OnFailure= writes the dead-man's failure log, which loop-status.json carries.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

HOME = pathlib.Path.home()
LL = pathlib.Path(os.environ.get("LL_HOME", HOME / "ll-loop"))
GATE_REPO = pathlib.Path(os.environ.get("LL_GATE_REPO", HOME / "lucky-loop-gate"))
MIRROR = pathlib.Path(os.environ.get("LL_MIRROR", HOME / "lucky-loop-artifacts"))
MIRROR_URL = os.environ.get("LL_MIRROR_URL", "git@github.com:Karl-W-W/lucky-loop-artifacts.git")
KEY = pathlib.Path(os.environ.get("LL_MIRROR_KEY", HOME / ".ssh" / "lucky-loop-artifacts-deploy"))
STATE = HOME / ".local" / "state" / "lucky-loop"
LOG = STATE / "artifact-return.log"
LOCK = STATE / "artifact-return.lock"
BEATS = HOME / ".local" / "state" / "heartbeats"
HEARTBEAT = HOME / "brain" / "tools" / "heartbeat"
PUBLIC_REPO = "Karl-W-W/lucky-loop"
WORKFLOW = "artifact-return.yml"
STATUS_MAX_AGE_H = 12
ARTIFACTS = ("loop-runs.json", "loop-def.json", "loop-status.json")
STAGED = ARTIFACTS + ("gate.json",)
DRY = "--dry-run" in sys.argv

# run.py's exit contract, copied from scripts/sync-loop.mjs so the status file never needs a guess.
EXIT_MEANING = {
    0: "converged — a pass ran and its assertion held",
    2: "already-recorded — this item+graph+model had a pass; queue advanced",
    3: "FAILED — error, redaction violation, refused write-back, or cap exhausted",
    4: "idle — the inbox was empty, nothing to process",
}

passes = "?"
new = "?"
gate = "skipped"
tokens = "?"
pushed = "no"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def finish(reason: str, code: int) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(f"{utc_now()} passes={passes} new={new} gate={gate} tokens={tokens} pushed={pushed} reason={reason}\n")
    print(f"artifact-return: passes={passes} new={new} gate={gate} tokens={tokens} pushed={pushed} reason={reason}")
    try:
        LOCK.rmdir()
    except OSError:
        pass
    sys.exit(code)


def git(repo: pathlib.Path, *args: str, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, env=env, check=check, timeout=300)


def mirror_env() -> dict:
    env = os.environ.copy()
    env["GIT_SSH_COMMAND"] = (
        f"ssh -i {KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
    )
    return env


# --- the probe: what scripts/sync-loop.mjs used to run over ssh, run here instead ------------------

def show(unit: str, props: list[str]) -> dict:
    try:
        out = subprocess.run(
            ["systemctl", "--user", "show", unit] + ["-p" + p for p in props],
            capture_output=True, text=True, timeout=15,
        ).stdout
        return dict(ln.split("=", 1) for ln in out.splitlines() if "=" in ln)
    except Exception:  # noqa: BLE001
        return {}


def epoch(s: str | None) -> int | None:
    """systemd renders *USec properties as 'Fri 2026-08-21 14:30:00 CEST'; convert on the box that
    owns the clock (the same reason the ssh probe converted here)."""
    if not s or s in ("n/a", "0", "infinity"):
        return None
    if s.startswith("@"):
        try:
            return int(float(s[1:]))
        except ValueError:
            return None
    try:
        r = subprocess.run(["date", "-d", s, "+%s"], capture_output=True, text=True, timeout=10)
        v = r.stdout.strip()
        return int(v) if r.returncode == 0 and v else None
    except Exception:  # noqa: BLE001
        return None


def iso(e: int | None) -> str | None:
    if e is None or e <= 0:
        return None
    return datetime.fromtimestamp(e, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def count_files(p: pathlib.Path) -> int | None:
    try:
        return len([q for q in p.iterdir() if q.is_file() and not q.name.startswith(".")])
    except OSError:
        return None


def status_snapshot(runs: list) -> dict:
    inbox = LL / "inbox"
    timer = show("lucky-loop.timer", ["ActiveState", "NextElapseUSecRealtime", "LastTriggerUSec"])
    svc = show("lucky-loop.service", ["ExecMainStatus", "ExecMainExitTimestamp", "ActiveState"])
    fail_at = None
    try:
        lines = [ln for ln in (HOME / "logs" / "lucky-loop-failures.log").read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
        if lines:
            fail_at = epoch(lines[-1].split(" ", 1)[0])
    except OSError:
        pass
    doc_types = sorted({r.get("item", {}).get("docType") for r in runs if isinstance(r, dict) and r.get("item", {}).get("docType")})
    last = max((r.get("finishedAt") for r in runs if isinstance(r, dict) and r.get("finishedAt")), default=None)
    try:
        exit_code: int | None = int(svc.get("ExecMainStatus", ""))
    except ValueError:
        exit_code = None
    return {
        "schema": 1,
        "about": (
            "Sampled on the loop host by deploy/artifact-return/artifact-return.py and carried to this "
            "repo by the artifact-return Action as a PR. A SNAPSHOT, not a feed: every field below was "
            "true at syncedAt and says nothing about now. Show syncedAt beside anything you render from this file."
        ),
        "syncedAt": utc_now(),
        "loop": {
            "lastPassAt": last,
            "passCount": len(runs),
            "docTypes": doc_types,
            "queueDepth": count_files(inbox),
            "processedCount": count_files(inbox / ".done"),
            "scheduler": {
                "active": timer.get("ActiveState") == "active",
                "lastTickAt": iso(epoch(timer.get("LastTriggerUSec"))),
                "nextTickAt": iso(epoch(timer.get("NextElapseUSecRealtime"))),
            },
            "lastTick": {
                "exit": exit_code,
                "meaning": EXIT_MEANING.get(exit_code, "unknown") if exit_code is not None else "unknown",
                "at": iso(epoch(svc.get("ExecMainExitTimestamp"))),
            },
            "lastFailureAt": iso(fail_at),
        },
    }


# --- the gate, run against the PUBLISHED gate code with the REAL deny-list ------------------------

def name_token_count() -> int:
    """How many non-empty entries the local deny-list holds. The count is attested, never the tokens."""
    try:
        spec = importlib.util.spec_from_file_location("name_tokens_local", LL / "name_tokens_local.py")
        mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        return len([t for t in getattr(mod, "NAME_TOKENS", []) if str(t).strip()])
    except Exception:  # noqa: BLE001
        return 0


def run_gates(payload: dict[str, bytes]) -> tuple[str, int, dict]:
    """Returns (verdict, token count, detail). verdict: strong | weak | red."""
    git(GATE_REPO, "fetch", "-q", "origin", "main")
    git(GATE_REPO, "reset", "-q", "--hard", "origin/main")
    link = GATE_REPO / "loop" / "name_tokens_local.py"  # gitignored in the repo, so reset leaves it alone
    if not link.exists():
        link.symlink_to(LL / "name_tokens_local.py")
    for name in ARTIFACTS:
        (GATE_REPO / "data" / name).write_bytes(payload[name])
    try:
        r1 = subprocess.run([sys.executable, "loop/check_artifacts.py"], cwd=GATE_REPO, capture_output=True, text=True, timeout=300)
        r2 = subprocess.run([sys.executable, "loop/test_redaction.py"], cwd=GATE_REPO, capture_output=True, text=True, timeout=300)
    finally:
        git(GATE_REPO, "checkout", "-q", "--", "data/")
    loaded = "local deny-list LOADED" in r1.stdout
    n = name_token_count()
    code = git(GATE_REPO, "rev-parse", "--short", "HEAD").stdout.strip()
    detail = {"check_artifacts": r1.returncode, "test_redaction": r2.returncode, "denyListLoaded": loaded, "gateCode": code}
    if r1.returncode != 0 or r2.returncode != 0:
        return "red", n, detail
    if not loaded or n == 0:
        return "weak", n, detail
    return "strong", n, detail


# --- the mirror ---------------------------------------------------------------------------------

def mirror_prepare(env: dict) -> bool:
    """Clone or refresh the mirror; return True when origin/main exists (False on the very first run)."""
    if not (MIRROR / ".git").exists():
        subprocess.run(["git", "clone", "-q", MIRROR_URL, str(MIRROR)], env=env, check=True, capture_output=True, text=True, timeout=300)
        git(MIRROR, "config", "core.sshCommand", env["GIT_SSH_COMMAND"])
    git(MIRROR, "fetch", "-q", "origin", env=env)
    has_main = git(MIRROR, "rev-parse", "--verify", "-q", "origin/main", check=False).returncode == 0
    if has_main:
        git(MIRROR, "checkout", "-q", "-B", "main", "origin/main")
        git(MIRROR, "reset", "-q", "--hard", "origin/main")
    else:
        git(MIRROR, "symbolic-ref", "HEAD", "refs/heads/main")
    return has_main


def action_probe() -> None:
    """Best effort, never fatal: mirror the Action's last successful run into a heartbeat file, so
    KR-0 sees the OTHER half of the hop go silent too (the dead-man condition of the council)."""
    try:
        url = f"https://api.github.com/repos/{PUBLIC_REPO}/actions/workflows/{WORKFLOW}/runs?per_page=1&status=success"
        req = urllib.request.Request(url, headers={"User-Agent": "lucky-loop artifact-return", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 — fixed https URL
            data = json.loads(resp.read().decode("utf-8"))
        run = (data.get("workflow_runs") or [None])[0]
        if not run:
            return
        t = datetime.strptime(run["updated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
        BEATS.mkdir(parents=True, exist_ok=True)
        f = BEATS / "artifact-return-action"
        f.touch()
        os.utime(f, (t, t))
    except Exception:  # noqa: BLE001
        return


def main() -> None:
    global passes, new, gate, tokens, pushed
    STATE.mkdir(parents=True, exist_ok=True)
    try:
        LOCK.mkdir()
    except FileExistsError:
        if time.time() - LOCK.stat().st_mtime > 3600:
            LOCK.rmdir()
            LOCK.mkdir()
        else:
            print("artifact-return: another run holds the lock")
            sys.exit(0)
    subprocess.run([sys.executable, str(HEARTBEAT), "beat", "artifact-return"], capture_output=True, timeout=30, check=False)
    action_probe()

    try:
        runs_bytes = (LL / "out" / "loop-runs.json").read_bytes()
        def_bytes = (LL / "out" / "loop-def.json").read_bytes()
        runs_doc = json.loads(runs_bytes)
    except (OSError, ValueError):
        finish("no-readable-artifact-on-host", 1)
    runs = runs_doc.get("runs", []) if isinstance(runs_doc, dict) else runs_doc
    passes = str(len(runs))
    status = status_snapshot(runs)
    payload = {
        "loop-runs.json": runs_bytes,
        "loop-def.json": def_bytes,
        "loop-status.json": (json.dumps(status, indent=2) + "\n").encode("utf-8"),
    }

    env = mirror_env()
    try:
        has_main = mirror_prepare(env)
    except subprocess.CalledProcessError:
        finish("mirror-unreachable", 1)

    # --- idempotence + the floor, against the mirror's last copy -----------------------------------
    prev_runs = (MIRROR / "loop-runs.json").read_bytes() if has_main and (MIRROR / "loop-runs.json").exists() else None
    prev_def = (MIRROR / "loop-def.json").read_bytes() if has_main and (MIRROR / "loop-def.json").exists() else None
    prev_count = 0
    if prev_runs is not None:
        try:
            d = json.loads(prev_runs)
            prev_count = len(d.get("runs", []) if isinstance(d, dict) else d)
        except ValueError:
            prev_count = 0
    if len(runs) < prev_count:
        finish(f"REFUSED:host-returned-fewer-passes-than-staged({len(runs)}<{prev_count})", 1)
    new = str(len(runs) - prev_count)
    runs_changed = prev_runs != runs_bytes or prev_def != def_bytes
    age_h = 10**6
    try:
        prev_status = json.loads((MIRROR / "loop-status.json").read_text(encoding="utf-8"))
        prev_epoch = datetime.strptime(prev_status["syncedAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
        age_h = int((time.time() - prev_epoch) // 3600)
    except (OSError, ValueError, KeyError):
        pass
    if not runs_changed and age_h < STATUS_MAX_AGE_H:
        finish(f"unchanged(snapshot-age={age_h}h)", 0)

    # --- the gate -----------------------------------------------------------------------------------
    gate, n, detail = run_gates(payload)
    tokens = str(n)
    if gate != "strong":
        finish(f"REFUSED:gate-{gate}(check_artifacts={detail['check_artifacts']},tests={detail['test_redaction']},loaded={detail['denyListLoaded']})", 1)
    newest = max((r.get("finishedAt") for r in runs if isinstance(r, dict) and r.get("finishedAt")), default=None)
    attestation = {
        "schema": 1,
        "about": (
            "Written on the loop host by deploy/artifact-return/artifact-return.py after the redaction gate "
            "(patterns AND the local name deny-list) and its tests passed there. An ATTESTATION by the host "
            "that wrote the artifact, not an independent check: the Action refuses when this file is absent, "
            "gate is not 'strong', nameTokens is below its floor, at is older than the newest pass, or a "
            "sha256 differs — and it re-runs the pattern half itself, labelling this half attested."
        ),
        "gate": gate,
        "nameTokens": n,
        "at": utc_now(),
        "artifactNewestAt": newest,
        "passCount": len(runs),
        "sha256": {name: sha256(payload[name]) for name in ARTIFACTS},
        "checks": {"check_artifacts": detail["check_artifacts"], "test_redaction": detail["test_redaction"]},
        "gateCode": detail["gateCode"],
    }
    what = f"{new} new pass(es)" if runs_changed else "status snapshot"
    if DRY:
        finish(f"dry-run(would-stage:{what})", 0)

    # --- stage: exactly these four files, nothing else, one ref -------------------------------------
    for name in ARTIFACTS:
        (MIRROR / name).write_bytes(payload[name])
    (MIRROR / "gate.json").write_text(json.dumps(attestation, indent=2) + "\n", encoding="utf-8")
    porcelain = [ln[3:] for ln in git(MIRROR, "status", "--porcelain").stdout.splitlines() if ln.strip()]
    foreign = [p for p in porcelain if p not in STAGED]
    if foreign:
        git(MIRROR, "checkout", "-q", "--", ".", check=False)
        finish(f"REFUSED:foreign-path-in-mirror(count={len(foreign)})", 1)
    git(MIRROR, "add", "--", *STAGED)
    if git(MIRROR, "diff", "--cached", "--quiet", check=False).returncode == 0:
        finish("nothing-staged", 0)
    msg = f"artifact-return: {what} — {passes} pass(es) on the host; gate {gate} ({tokens} name tokens); sampled {status['syncedAt']}"
    git(MIRROR, "-c", "user.name=loop host (artifact-return)", "-c", "user.email=artifact-return@lucky-loop.invalid", "commit", "-q", "-m", msg)
    r = git(MIRROR, "push", "-q", "origin", "HEAD:main", env=env, check=False)
    if r.returncode != 0:
        finish("push-failed(commit-kept-local)", 1)
    git(MIRROR, "fetch", "-q", "origin", env=env, check=False)
    if git(MIRROR, "rev-parse", "origin/main").stdout.strip() == git(MIRROR, "rev-parse", "HEAD").stdout.strip():
        pushed = "yes"
    finish(f"staged({what})", 0)


if __name__ == "__main__":
    main()

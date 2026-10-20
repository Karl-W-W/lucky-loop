#!/usr/bin/env python3
"""artifact-return-verify — the public repo's half of the boundary, run inside
.github/workflows/artifact-return.yml on a GitHub runner.

The loop host stages three redacted artifacts plus gate.json in a private mirror
(deploy/artifact-return/artifact-return.py). This script decides whether the runner may
carry them into data/ and open a PR. It refuses, loudly, when:

  * gate.json is absent, malformed, or says anything but "strong";
  * nameTokens is below NAME_TOKEN_FLOOR — a stubbed or partially-synced deny-list on the
    host imports fine and would attest "strong" over the four FICTIONAL defaults (the exact
    fail-open of 2026-08-11), so the count is bounded here, where the host has no say;
  * gate.at is older than the newest pass in the artifact, or a sha256 differs from the bytes;
  * the mirror holds FEWER passes than are committed — published history never shrinks on
    the word of one host (the gen-ledger / sync-loop guard, moved to the only place with
    authority over published history).

  * the mirror's ci-runs.json (optional; 2026-09-19) holds fewer gate runs than are committed, or
    has lost one it already published — the same floor, for the snapshot O3/KR3 is derived from.
    Rows only: the clean-day count is allowed to FALL, because a gate failure resetting the streak
    is precisely what that KR measures and a guard against it would make the number unfalsifiable.

When everything holds it copies the files into data/ and reports, in counts only —
this log is public — whether there is anything to publish: a new pass, a newer CI snapshot, or a
status snapshot older than STATUS_MAX_AGE_H hours. Outputs (also written to $GITHUB_OUTPUT when
set): changed=yes|no, what, passes, tokens, reason.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sys
from datetime import datetime, timedelta, timezone

REPO = pathlib.Path(__file__).resolve().parent.parent
ARTIFACTS = ("loop-runs.json", "loop-def.json", "loop-status.json")
# ci-runs.json (2026-09-19) is OPTIONAL on the mirror and required to be sound when present: the
# nightly-queue job that writes it is new, and an old mirror copy or a night the box was down must
# not turn this job red and strand the loop's artifacts. Its own floor is below.
CI_RUNS = "ci-runs.json"
NAME_TOKEN_FLOOR = 6  # the deny-list's known size; CLAUDE.md states the count publicly, never the tokens
STATUS_MAX_AGE_H = 12


def fail(msg: str) -> None:
    print(f"::error::artifact-return-verify: {msg}")
    out("changed", "no")
    out("reason", msg)
    sys.exit(1)


def out(key: str, value: str) -> None:
    print(f"{key}={value}")
    p = os.environ.get("GITHUB_OUTPUT")
    if p:
        with open(p, "a", encoding="utf-8") as fh:
            fh.write(f"{key}={value}\n")


def ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def run_count(raw: bytes) -> int:
    d = json.loads(raw)
    runs = d.get("runs", []) if isinstance(d, dict) else d
    if not isinstance(runs, list):
        raise ValueError("runs is not a list")
    return len(runs)


def main() -> int:
    if len(sys.argv) != 2:
        fail("usage: artifact-return-verify.py <mirror-dir>")
    mirror = pathlib.Path(sys.argv[1])
    for name in ARTIFACTS + ("gate.json",):
        if not (mirror / name).is_file():
            fail(f"{name} missing from the mirror")
    extra = sorted(p.name for p in mirror.iterdir() if p.name not in ARTIFACTS + (CI_RUNS, "gate.json", ".git"))
    if extra:
        fail(f"{len(extra)} unexpected file(s) in the mirror — refusing")

    try:
        gate = json.loads((mirror / "gate.json").read_text(encoding="utf-8"))
    except ValueError:
        fail("gate.json is not JSON")
    if gate.get("schema") != 1 or gate.get("gate") != "strong":
        fail(f"gate.json says gate={gate.get('gate')!r} (need strong)")
    tokens = gate.get("nameTokens")
    if not isinstance(tokens, int) or tokens < NAME_TOKEN_FLOOR:
        fail(f"nameTokens below the floor ({NAME_TOKEN_FLOOR})")
    checks = gate.get("checks") or {}
    if checks.get("check_artifacts") != 0 or checks.get("test_redaction") != 0:
        fail("gate.json records a non-zero gate exit")
    shas = gate.get("sha256") or {}
    payload: dict[str, bytes] = {}
    names = ARTIFACTS + ((CI_RUNS,) if (mirror / CI_RUNS).is_file() else ())
    for name in names:
        payload[name] = (mirror / name).read_bytes()
        if hashlib.sha256(payload[name]).hexdigest() != shas.get(name):
            fail(f"sha256 mismatch on {name}")

    try:
        incoming = run_count(payload["loop-runs.json"])
        json.loads(payload["loop-def.json"])
        status = json.loads(payload["loop-status.json"])
    except ValueError as exc:
        fail(f"unparseable artifact ({type(exc).__name__})")
    runs = json.loads(payload["loop-runs.json"])
    runs = runs.get("runs", []) if isinstance(runs, dict) else runs
    newest = max((ts(r.get("finishedAt")) for r in runs if isinstance(r, dict)), default=None, key=lambda d: d or datetime.min.replace(tzinfo=timezone.utc))
    at = ts(gate.get("at"))
    if at is None:
        fail("gate.json has no parseable at")
    if newest and at < newest:
        fail("gate.json is older than the newest pass")
    if at > datetime.now(timezone.utc) + timedelta(days=1):
        fail("gate.json is dated in the future")
    synced = ts(status.get("syncedAt"))
    if synced is None:
        fail("loop-status.json has no parseable syncedAt")

    committed_runs = (REPO / "data" / "loop-runs.json").read_bytes() if (REPO / "data" / "loop-runs.json").exists() else b""
    committed_def = (REPO / "data" / "loop-def.json").read_bytes() if (REPO / "data" / "loop-def.json").exists() else b""
    committed = run_count(committed_runs) if committed_runs else 0
    if incoming < committed:
        fail(f"REFUSING — the mirror holds {incoming} pass(es) but {committed} are committed")
    runs_changed = committed_runs != payload["loop-runs.json"] or committed_def != payload["loop-def.json"]

    # The CI snapshot's floor, on the only side with authority over published history. Rows, never
    # the clean-day count: a gate failure resets the streak to 0 by design, and refusing to publish
    # that would make "zero gate failures" a number that cannot fall. sync-ci.mjs says the same in
    # more words. A snapshot that has LOST a run it already published is the refusable case.
    ci_changed = False
    ci_runs_in = ci_runs_committed = 0
    if CI_RUNS in payload:
        committed_ci = (REPO / "data" / CI_RUNS).read_bytes() if (REPO / "data" / CI_RUNS).exists() else b""
        try:
            ci_runs_in = run_count(payload[CI_RUNS])
            ci_runs_committed = run_count(committed_ci) if committed_ci else 0
        except ValueError as exc:
            fail(f"unparseable {CI_RUNS} ({type(exc).__name__})")
        if ci_runs_in < ci_runs_committed:
            fail(f"REFUSING — the mirror's {CI_RUNS} holds {ci_runs_in} run(s) but {ci_runs_committed} are committed")
        have = {f"{r.get('repo')}#{r.get('run')}" for r in json.loads(payload[CI_RUNS]).get("runs", [])}
        lost = [f"{r.get('repo')}#{r.get('run')}" for r in (json.loads(committed_ci).get("runs", []) if committed_ci else [])
                if f"{r.get('repo')}#{r.get('run')}" not in have]
        if lost:
            fail(f"REFUSING — {len(lost)} published gate run(s) absent from the mirror's {CI_RUNS}")
        ci_changed = committed_ci != payload[CI_RUNS]

    age_h = 10**6
    try:
        prev = json.loads((REPO / "data" / "loop-status.json").read_text(encoding="utf-8"))
        prev_synced = ts(prev.get("syncedAt"))
        if prev_synced:
            age_h = int((synced - prev_synced).total_seconds() // 3600)
    except (OSError, ValueError):
        pass

    print(f"verify: gate strong, {tokens} name tokens attested, {incoming} pass(es) in the mirror, {committed} committed")
    if CI_RUNS in payload:
        print(f"verify: {CI_RUNS} — {ci_runs_in} gate run(s) in the mirror, {ci_runs_committed} committed")
    out("passes", str(incoming))
    out("tokens", str(tokens))
    if not runs_changed and not ci_changed and age_h < STATUS_MAX_AGE_H:
        out("changed", "no")
        out("what", "nothing")
        out("reason", f"runs, definition and CI snapshot unchanged; committed snapshot is {age_h} h old (< {STATUS_MAX_AGE_H})")
        return 0
    for name in payload:
        (REPO / "data" / name).write_bytes(payload[name])
    if runs_changed:
        what = f"{incoming - committed} new pass(es), canvas regenerated"
    elif ci_changed:
        what = f"CI snapshot, +{ci_runs_in - ci_runs_committed} gate run(s)"
    else:
        what = "status snapshot"
    out("changed", "yes")
    out("what", what)
    out("reason", what)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

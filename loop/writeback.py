"""Steps 6-7 of the architecture pin: the loop writes its OWN pass to the vault.

The pin (captures/mission-launch-2026-07-31.md) says each pass emits
`brain-log.py` decision+outcome events. It never did. Until 2026-08-11 there was
not one line in loop/ that referenced the vault, brain-log, or any process
spawn — the write-back half was never written, and every "the loop ran" claim
rested on an artifact a human had carried across by hand.

DESIGN NOTES, each one load-bearing:

* THE SINK LIVES IN THE RUNNER, NOT THE GRAPH. `adapt` stays a pure function so
  the graph remains testable and `describe()` keeps deriving data/loop-def.json
  from something with no I/O in it. The vault write happens once per pass, after
  the redaction gates have already cleared the payload.

* decision_id IS THE IDEMPOTENCY KEY, NOT THE runId. `runId` embeds the run
  DATE, so re-running the same document tomorrow would mint a new business key,
  miss brain-log's dedupe, and append a SECOND permanent line to a log that is
  append-only and immutable. `loop:{idempotencyKey}` is content-derived, so a
  re-run of the same bytes collides on purpose and brain-log no-ops with exit 2.

* THE VAULT IS A SECOND PUBLICATION SURFACE. Everything handed to brain-log.py
  is re-checked against gate 1 here, even though run.py already cleared the
  artifact. A string that is safe inside a JSON file is not automatically safe
  as a CLI argument that lands in a log line, a filename and a git commit
  message. Fail-closed: nothing is emitted if the gate finds anything.

* ONE WRITER AT A TIME. brain-log.py has no locking of any kind (verified:
  zero matches for flock/fcntl/LOCK_EX in it). Its append to log.md is a small
  O_APPEND write and mostly survives a race, but `git add` + `git commit` are
  two separate subprocesses — a concurrent writer loses the index.lock race and
  leaves log.md appended and never committed, silently desynchronising the
  "immutable" ledger from git history. So every write here takes an exclusive
  flock first.
"""

from __future__ import annotations

import fcntl
import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from redact import verify_clean

# brain-log.py's own exit contract.
BRAINLOG_OK = 0
BRAINLOG_DUPLICATE = 2
BRAINLOG_COLLISION = 3


def vault_repo() -> Path:
    """Where the vault lives. BRAIN_REPO wins, matching brain-log.py itself."""
    return Path(os.environ.get("BRAIN_REPO") or Path.home() / "brain")


@contextmanager
def single_writer(brain: Path):
    """Exclusive lock for the whole write. See the module docstring."""
    lock_path = brain / ".git" / "lucky-loop-writeback.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(lock_path, "w")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(handle, fcntl.LOCK_UN)
        handle.close()


def node_output(record: dict[str, Any], name: str) -> dict[str, Any]:
    """Read one node's output off the artifact.

    Deliberately reads the existing `nodes` list rather than adding top-level
    `action`/`evaluation` keys. The artifact schema is rendered by /loop and
    mirrored into the langflow canvas, so widening it to serve this module would
    make the write-back a schema change instead of an addition.
    """
    for node in record.get("nodes", []):
        if node.get("node") == name:
            return node.get("output", {}) or {}
    return {}


def compose_intent(record: dict[str, Any]) -> str:
    """The one-line intent, composed in CODE from typed fields.

    Never the model's words and never the document's. `humanSummary` is itself
    assembled in graph.py out of enum values, which is why it is safe to reuse
    here — see act() in loop/graph.py.
    """
    return node_output(record, "act").get("humanSummary", "")


def _run(cmd: list[str], brain: Path) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=str(brain), capture_output=True, text=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def emit(record: dict[str, Any], brain: Path | None = None, push: bool = True) -> list[str]:
    """Write decision+outcome events for one pass. Returns a list of problems.

    An empty list means the vault now holds this pass. Callers treat a non-empty
    list as a run failure: a pass the vault never heard about is exactly the gap
    this function exists to close, so silently tolerating it would reproduce it.
    """
    brain = brain or vault_repo()
    tool = brain / "tools" / "brain-log.py"
    if not tool.exists():
        return [f"vault: {tool} not present — no event written"]

    decision_id = f"loop:{record['idempotencyKey']}"
    intent = compose_intent(record)
    evaluation = node_output(record, "evaluate")
    converged = record["terminationReason"] == "converged"
    if not intent:
        return ["vault: artifact has no act.humanSummary — refusing to emit an empty intent"]

    # FAIL-CLOSED re-gate. Every string that will leave this process as an
    # argv element is checked, not just the artifact it came from.
    outbound = {
        "decisionId": decision_id,
        "intent": intent,
        "assertion": evaluation.get("assertion", ""),
        "model": record["model"],
        "graphVersion": record["graphVersion"],
        "terminationReason": record["terminationReason"],
    }
    violations = verify_clean(outbound)
    if violations:
        return [f"vault: REFUSING to emit — redaction violation in {v}" for v in violations]

    decision = [
        sys.executable, str(tool), "decision",
        "--decision-id", decision_id,
        "--source", "loop",
        "--mode", "live",
        "--entity", "lucky-loop",
        "--intent", intent,
        "--param", f"assertion={evaluation.get('assertion', '')}",
        "--param", f"graphVersion={record['graphVersion']}",
        "--param", f"model={record['model']}",
        "--decided-ts", record["startedAt"],
        "--commit",
    ]
    outcome = [
        sys.executable, str(tool), "outcome",
        "--decision-id", decision_id,
        "--source", "loop",
        "--utility-metric", "iterations_to_converge",
        "--utility-value", str(record["iterations"]),
        "--outcome", "win" if converged else "loss",
        "--resolved-ts", record["finishedAt"],
        "--commit",
    ]

    problems: list[str] = []
    with single_writer(brain):
        # Rebase onto the shared bare origin BEFORE writing, so the append and
        # the push see the same history. log.md is append-only, so two writers
        # appending independently is the one conflict shape that actually bites.
        #
        # A failed pull ABORTS before writing anything. The first version of
        # this recorded the failure and then wrote anyway, which is the worst of
        # both: events land on a history that was never reconciled, the push is
        # skipped because problems is non-empty, and the two clones silently
        # diverge — with the run reporting failure even though it had written.
        has_origin, _ = _run(["git", "remote", "get-url", "origin"], brain)
        if has_origin == 0:
            code, out = _run(["git", "pull", "--rebase", "--quiet", "origin", "master"], brain)
            if code != 0:
                # UNWIND THE REBASE. This is the failure this loop is most likely
                # to actually hit: log.md is append-only, so when the Mac and the
                # DGX both append, rebasing one onto the other CONFLICTS on the
                # last line every time.
                #
                # Returning here without aborting would leave ~/brain sitting in
                # .git/rebase-merge — which breaks the NEXT run's pull, and every
                # `git` command the human runs in their own vault, until someone
                # notices and unwinds it by hand. An unattended writer that can
                # wedge the repo it writes to is worse than one that never runs.
                _run(["git", "rebase", "--abort"], brain)
                still, state = _run(["git", "rev-parse", "--verify", "REBASE_HEAD"], brain)
                stuck = " AND THE REBASE DID NOT UNWIND — run `git -C %s rebase --abort`" % brain
                return [
                    f"vault: pre-write pull failed (rc={code}) {out[:200]} — wrote NOTHING "
                    f"rather than append to an unreconciled history"
                    + (stuck if still == 0 else "; rebase unwound, vault left as it was")
                ]
        else:
            print("vault: no origin remote — writing locally only, nothing to pull or push")
            push = False

        for label, cmd in (("decision", decision), ("outcome", outcome)):
            code, out = _run(cmd, brain)
            if code == BRAINLOG_DUPLICATE:
                print(f"vault: {label} {decision_id} already recorded — idempotent no-op")
            elif code == BRAINLOG_COLLISION:
                problems.append(
                    f"vault: KEY COLLISION on {decision_id} {label} — same key, different payload. "
                    "See review/key-collisions.md. Nothing was overwritten."
                )
            elif code != BRAINLOG_OK:
                problems.append(f"vault: {label} failed (rc={code}) {out[:200]}")

        if push and not problems:
            code, out = _run(["git", "push", "--quiet", "origin", "master"], brain)
            if code != 0:
                problems.append(
                    f"vault: events are COMMITTED LOCALLY but the push failed (rc={code}) {out[:200]} "
                    "— pull on the other clone before writing again"
                )

    return problems

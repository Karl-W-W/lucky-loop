"""Run one loop pass over one real item and emit the artifacts /loop renders.

Contract (from the launch mission's HARVEST list):

  exit 0  terminationReason == "converged" — and nothing else earns a zero.
  exit 2  idempotent success: this exact item+graph+model already has a
          recorded pass. No second record is written; the item is consumed so
          the queue still advances.
  exit 3  hard fail: an error, a redaction violation, a refused write-back, or
          cap exhaustion. Cap exhaustion is NOT success.
  exit 4  nothing to do: the inbox is empty or absent. Added when the loop
          became SCHEDULED — an empty queue is the normal resting state of a
          timer that fires every 10 minutes, not a fault. Reporting it as
          exit 3 would have painted the unit failed for most of every day and
          taught the operator to ignore a red light. The systemd unit lists
          0, 2 and 4 as SuccessExitStatus.

Evidence of a run is the committed artifact and the vault event, never this
process's stdout or exit code. The exit code is for the shell; the artifact is
for the record.

Usage:
    python3 loop/run.py --inbox loop/inbox --model llama3.2:3b
    python3 loop/run.py --emit-def-only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

from graph import GRAPH_VERSION, build, describe, vocabulary  # noqa: E402
from redact import (  # noqa: E402
    LOCAL_TOKENS_LOADED,
    source_tokens,
    verify_clean,
    verify_no_source_tokens,
)
from writeback import emit as emit_vault_events  # noqa: E402

EXIT_OK = 0
EXIT_ALREADY_RAN = 2
EXIT_FAIL = 3
EXIT_EMPTY = 4


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def pick_item(inbox: Path) -> Path | None:
    """Exactly one item per pass — the first by name. Returns None if there is
    nothing to do.

    The docstring here used to claim "ambiguity is an error, not a guess" while
    the code silently took items[0] and ignored the rest. It is now a real
    queue: consume_item() moves each processed file into .done/ after a
    successful pass, so a backlog drains one item per tick instead of the same
    file being re-picked forever. The remaining count is reported, never hidden.

    Both empty cases used to `raise SystemExit(<str>)`, which exits 1 — outside
    this file's own documented {0, 2, 3, 4} contract, so any wrapper branching on
    the contract misread it as an unknown failure.
    """
    if not inbox.exists():
        print(f"inbox {inbox} does not exist — drop one exported item there first", file=sys.stderr)
        return None
    items = sorted(p for p in inbox.iterdir() if p.is_file() and not p.name.startswith("."))
    if not items:
        print(f"inbox {inbox} is empty — nothing to process", file=sys.stderr)
        return None
    if len(items) > 1:
        print(f"queue: {len(items)} items waiting; processing {items[0].name}, {len(items) - 1} left after this")
    return items[0]


def consume_item(item: Path, outcome: str) -> None:
    """Move a processed item out of the queue so the next pass advances.

    Without this the loop is not a loop: pick_item always returns the
    alphabetically first file, so a scheduled run re-reads the same document
    every tick and exits 2 forever. Dropping a second item in changes nothing,
    because nothing ever removes the first.

    `.done/` and `.failed/` sit inside the gitignored inbox and start with a
    dot, so pick_item's own filter skips them and consumed items stay off git.
    """
    dest = item.parent / f".{outcome}"
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / item.name
    if target.exists():
        target.unlink()
    item.rename(target)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inbox", default=str(REPO / "loop" / "inbox"))
    parser.add_argument("--out", default=str(REPO / "data"))
    parser.add_argument("--model", default="llama3.2:3b")
    parser.add_argument("--max-iterations", type=int, default=3)
    parser.add_argument("--emit-def-only", action="store_true")
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="the item is known-fabricated test data; allowed without the local name deny-list",
    )
    parser.add_argument("--no-vault", action="store_true", help="skip the vault write-back")
    parser.add_argument("--brain-repo", default=None, help="vault path (default: $BRAIN_REPO or ~/brain)")
    args = parser.parse_args()

    out_dir = Path(args.out)
    compiled = build()

    # The definition is always derived from the compiled graph, on every run.
    definition = describe(compiled)
    definition["generatedAt"] = now_iso()
    if args.emit_def_only:
        write_json(out_dir / "loop-def.json", definition)
        print(f"wrote loop-def.json ({len(definition['nodes'])} nodes, {len(definition['edges'])} edges)")
        return EXIT_OK

    item = pick_item(Path(args.inbox))
    if item is None:
        return EXIT_EMPTY
    raw = item.read_text(encoding="utf-8", errors="replace")

    # FAIL-CLOSED on the name deny-list. Without loop/name_tokens_local.py,
    # redact.py falls back to a FICTIONAL default list, so gate 1 would not
    # redact the real owner's name by name — a silent downgrade on exactly the
    # path that publishes to a public repo. Synthetic items are fabricated by
    # construction and may proceed; anything else must not.
    if not LOCAL_TOKENS_LOADED and not args.synthetic:
        print(
            "REFUSING: loop/name_tokens_local.py is absent, so the name deny-list is the "
            "fictional default. Restore it, or pass --synthetic if this item is fabricated "
            "test data.",
            file=sys.stderr,
        )
        return EXIT_FAIL

    # Idempotency: same bytes + same graph + same model == same pass.
    key = hashlib.sha256(
        raw.encode("utf-8") + GRAPH_VERSION.encode() + args.model.encode()
    ).hexdigest()[:16]

    runs_path = out_dir / "loop-runs.json"
    runs = load_json(runs_path, {"runs": []})
    # Only a CONVERGED pass claims the key. The key has no success component, and
    # a cap-exhausted pass was written to the artifact BEFORE the failure exit —
    # so a document the loop failed on could never be retried: every later
    # attempt hit the key and reported "already recorded". Failed attempts stay
    # in the file for observability; they just no longer block a retry.
    if any(
        r.get("idempotencyKey") == key and r.get("terminationReason") == "converged"
        for r in runs["runs"]
    ):
        # Consume it anyway. This item IS done — its pass is on record — so
        # leaving it in the queue wedges an unattended loop permanently: every
        # tick re-picks the same finished document, exits 2, and never reaches
        # the item behind it. Advancing here is what makes "already ran" a
        # queue state rather than a dead end.
        consume_item(item, "done")
        print(f"idempotent: a converged pass for key {key} is already recorded; "
              f"no second record written, {item.name} moved to .done/")
        return EXIT_ALREADY_RAN

    # Written only now. A no-op re-run used to rewrite this file with a fresh
    # generatedAt before the check above, dirtying the tree and inviting a
    # commit that claimed a run happened when none did.
    write_json(out_dir / "loop-def.json", definition)

    started = time.time()
    started_iso = now_iso()
    try:
        final = compiled.invoke(
            {
                "raw_text": raw,
                "model": args.model,
                "max_iterations": args.max_iterations,
                "iterations": 0,
                "trace": [],
            },
            {"recursion_limit": 50},
        )
        reason = final.get("termination_reason", "error")
    except Exception as exc:  # noqa: BLE001 — any failure is a run failure
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return EXIT_FAIL

    record = {
        "runId": f"{started_iso[:10].replace('-', '')}-{key[:8]}",
        "idempotencyKey": key,
        "startedAt": started_iso,
        "finishedAt": now_iso(),
        "durationMs": int((time.time() - started) * 1000),
        "model": args.model,
        "graphVersion": GRAPH_VERSION,
        "terminationReason": reason,
        "iterations": final.get("iterations", 0),
        # How this pass was triggered, read from the environment rather than
        # asserted. PRECISELY: systemd sets INVOCATION_ID for every unit it
        # starts, so this distinguishes "systemd started me" from "a human ran
        # python3 run.py". It does NOT distinguish a TIMER firing from someone
        # typing `systemctl --user start lucky-loop.service` — both are systemd
        # starts and both land here as "schedule".
        #
        # The proof that a timer fired lives in systemd's own accounting, not
        # in this field: `systemctl --user show lucky-loop.service` reports
        # TriggeredBy=lucky-loop.timer, and list-timers' LAST column matches
        # the run timestamps on the 10-minute grid. Cite those, not this.
        "trigger": "schedule" if os.environ.get("INVOCATION_ID") else "manual",
        "item": {
            "source": "loop/inbox (gitignored)",
            "chars": final["perception"]["chars"],
            "lines": final["perception"]["lines"],
            "language": final["perception"]["language"],
            "issuerKind": final["perception"]["issuerKind"],
            "docType": final["perception"]["docType"],
            "amountBucket": final["perception"]["amountBucket"],
            "hasDueDate": final["perception"]["hasDueDate"],
        },
        "nodes": [
            {"node": "perceive", "output": final["perception"]},
            {"node": "decide", "output": final["decision"]},
            {"node": "act", "output": final["action"]},
            {"node": "evaluate", "output": final["evaluation"]},
            {"node": "adapt", "output": final["adaptation"]},
        ],
    }

    # The joint between the two halves of the record: the artifact names the
    # vault event it produced, so /loop and log.md can be reconciled without
    # guessing. Set BEFORE the gate so the gate inspects it like anything else.
    record["vault"] = {"decisionId": f"loop:{key}", "source": "loop"}

    # THE GATE — two independent checks, both must be empty before anything
    # reaches git. (1) PII-shaped spans. (2) anything lifted verbatim from the
    # source item, which is what keeps the SENDER's name out of the artifact.
    violations = verify_clean(record) + verify_no_source_tokens(
        record, source_tokens(raw, vocabulary())
    )
    if violations:
        print("REDACTION FAILURE — refusing to write. Violations:", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return EXIT_FAIL

    runs["runs"].insert(0, record)
    runs["generatedAt"] = now_iso()
    write_json(runs_path, runs)

    print(f"run {record['runId']} terminationReason={reason} iterations={record['iterations']}")

    if reason != "converged":
        # The record is on disk for observability, but the item is NOT consumed:
        # the narrowed idempotency check above means a failed document can be
        # retried. After three recorded attempts it moves to .failed/ so one
        # poison item cannot wedge an unattended queue forever.
        attempts = sum(1 for r in runs["runs"] if r.get("idempotencyKey") == key)
        if attempts >= 3:
            consume_item(item, "failed")
            print(f"{attempts} failed attempts — moved {item.name} to .failed/", file=sys.stderr)
        print("not converged — this is not a success", file=sys.stderr)
        return EXIT_FAIL

    # Converged. Advance the queue, then tell the vault.
    consume_item(item, "done")

    # STEPS 6-7 OF THE ARCHITECTURE PIN. A pass the vault never heard about is
    # the exact gap this closes, so a failed write-back is a failed run — it is
    # reported and returned, never swallowed into a zero exit.
    if args.no_vault:
        print("vault: skipped (--no-vault)")
        return EXIT_OK
    brain = Path(args.brain_repo) if args.brain_repo else None
    problems = emit_vault_events(record, brain=brain)
    if problems:
        print("VAULT WRITE-BACK FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return EXIT_FAIL
    print(f"vault: decision+outcome written for loop:{key}")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())

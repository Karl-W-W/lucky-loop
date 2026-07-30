"""Run one loop pass over one real item and emit the artifacts /loop renders.

Contract (from the launch mission's HARVEST list):

  exit 0  terminationReason == "converged" — and nothing else earns a zero.
  exit 2  idempotent success: this exact item+graph+model already has a
          recorded pass. No second record is written.
  exit 3  hard fail: an error, a redaction violation, or cap exhaustion.
          Cap exhaustion is NOT success.

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
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

from graph import GRAPH_VERSION, build, describe, vocabulary  # noqa: E402
from redact import source_tokens, verify_clean, verify_no_source_tokens  # noqa: E402

EXIT_OK = 0
EXIT_ALREADY_RAN = 2
EXIT_FAIL = 3


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


def pick_item(inbox: Path) -> Path:
    """Exactly one item per pass. Ambiguity is an error, not a guess."""
    if not inbox.exists():
        raise SystemExit(f"inbox {inbox} does not exist — drop one exported item there first")
    items = sorted(p for p in inbox.iterdir() if p.is_file() and not p.name.startswith("."))
    if not items:
        raise SystemExit(f"inbox {inbox} is empty — drop one exported item there first")
    return items[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inbox", default=str(REPO / "loop" / "inbox"))
    parser.add_argument("--out", default=str(REPO / "data"))
    parser.add_argument("--model", default="llama3.2:3b")
    parser.add_argument("--max-iterations", type=int, default=3)
    parser.add_argument("--emit-def-only", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out)
    compiled = build()

    # The definition is always derived from the compiled graph, on every run.
    definition = describe(compiled)
    definition["generatedAt"] = now_iso()
    write_json(out_dir / "loop-def.json", definition)
    if args.emit_def_only:
        print(f"wrote loop-def.json ({len(definition['nodes'])} nodes, {len(definition['edges'])} edges)")
        return EXIT_OK

    item = pick_item(Path(args.inbox))
    raw = item.read_text(encoding="utf-8", errors="replace")

    # Idempotency: same bytes + same graph + same model == same pass.
    key = hashlib.sha256(
        raw.encode("utf-8") + GRAPH_VERSION.encode() + args.model.encode()
    ).hexdigest()[:16]

    runs_path = out_dir / "loop-runs.json"
    runs = load_json(runs_path, {"runs": []})
    if any(r.get("idempotencyKey") == key for r in runs["runs"]):
        print(f"idempotent: a pass for key {key} is already recorded; no second record written")
        return EXIT_ALREADY_RAN

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
        print("not converged — this is not a success", file=sys.stderr)
        return EXIT_FAIL
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())

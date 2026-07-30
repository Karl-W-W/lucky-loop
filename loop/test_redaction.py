"""Proof that the sanitizer is a mechanism, not an intention.

DoD #2 and #4 fail on promises. A redaction step nobody has tried to defeat is
a promise. This file tries to defeat it.

Run:  python3 loop/test_redaction.py --inbox loop/inbox
Exit: 0 when every leak is caught and the real artifact is clean.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from graph import vocabulary  # noqa: E402
from redact import source_tokens, verify_clean, verify_no_source_tokens  # noqa: E402

# Each case is a leak the artifact must never carry. The label says which rule
# from the launch mission's SANITIZE clause it violates.
LEAKS = {
    "sender name (issuer)": "Amazon Web Services charge for the period",
    "sender name (personal)": "invoice addressed to Karl Wuerfel",
    "company name": "charges for POOL Music GmbH",
    "email address": "questions to billing@example.com",
    "currency amount": "total of EUR 312,45 payable",
    "invoice number": "reference 559480 is outstanding",
    "IBAN": "remit to DE89370400440532013000",
}


def wrap(text: str) -> dict:
    """Shape a candidate string like a real artifact so the walkers see it."""
    return {"nodes": [{"node": "act", "output": {"humanSummary": text}}]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inbox", default=str(HERE / "inbox"))
    parser.add_argument("--runs", default=str(HERE.parent / "data" / "loop-runs.json"))
    args = parser.parse_args()

    items = sorted(p for p in Path(args.inbox).iterdir() if p.is_file() and not p.name.startswith("."))
    if not items:
        print("no item in inbox — cannot build the source deny-list", file=sys.stderr)
        return 1
    raw = items[0].read_text(encoding="utf-8", errors="replace")
    forbidden = source_tokens(raw, vocabulary())

    failures = 0
    print(f"source deny-list: {len(forbidden)} proper-noun tokens from the item\n")
    print("NEGATIVE — every line must be caught:")
    for label, text in LEAKS.items():
        hits = verify_clean(wrap(text)) + verify_no_source_tokens(wrap(text), forbidden)
        if hits:
            kinds = ", ".join(sorted({h.split(": ", 1)[-1].split(" ")[0] for h in hits}))
            print(f"  caught   {label:24} ({kinds})")
        else:
            print(f"  MISSED   {label:24} <-- sanitizer gap")
            failures += 1

    print("\nPOSITIVE — the committed artifact must be clean:")
    runs_path = Path(args.runs)
    if not runs_path.exists():
        print(f"  skipped  {runs_path} not present")
    else:
        record = json.loads(runs_path.read_text(encoding="utf-8"))
        hits = verify_clean(record) + verify_no_source_tokens(record, forbidden)
        if hits:
            print(f"  DIRTY    {len(hits)} violation(s): {hits[:5]}")
            failures += 1
        else:
            print(f"  clean    {runs_path.name}")

    print()
    if failures:
        print(f"FAILED — {failures} problem(s)")
        return 1
    print("PASSED — every leak caught, artifact clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

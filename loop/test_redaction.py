"""Proof that the sanitizer is a mechanism, not an intention.

DoD #2 and #4 fail on promises. A redaction step nobody has tried to defeat is
a promise. This file tries to defeat it.

Run:  python3 loop/test_redaction.py
Exit: 0 when every leak is caught, every closed hole stays closed, and the
      committed artifact is clean.

PORTABILITY (changed 2026-08-11). This suite used to build its source deny-list
from loop/inbox/, which is GITIGNORED. That coupled its coverage to whichever
file happened to be sitting in an untracked directory: swap the inbox item and
the issuer-name case silently flips to MISSED, because the only thing that ever
caught it was gate 2 reading that specific document. It now builds the deny-list
from a COMMITTED synthetic fixture, so a fresh clone and a CI runner get the
same verdict as this laptop. When a real inbox item is present it is used as an
ADDITIONAL deny-list for the positive check, never as the only one.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import redact  # noqa: E402
from graph import vocabulary  # noqa: E402
from redact import source_tokens, verify_clean, verify_no_source_tokens  # noqa: E402

FIXTURE = HERE / "fixtures" / "synthetic-bill.txt"

# Each case is a leak the artifact must never carry. Every value here is
# FICTIONAL and matches loop/fixtures/synthetic-bill.txt plus redact.py's
# DEFAULT_NAME_TOKENS, so the suite proves the mechanism without the repo
# carrying the data.
#
# 2026-08-11: this dict used to carry the REAL invoice reference of the real
# ingested item. An Aug 5 check had cleared it by searching for the
# space-separated form while the document spells it with a hyphen — the check
# passed and the data was there the whole time. A fixture that carries live data
# is a leak with a test harness around it.
#
# Note the second-order trap, hit while writing this very comment: restating the
# removed value in the note that explains its removal puts it straight back into
# the repo. It is described here, never quoted.
LEAKS = {
    "sender name (issuer)": "Nordlicht Stromversorgung charge for the period",
    "sender name (personal)": "invoice addressed to Erika Mustermann",
    "company name": "charges for Example Media GmbH",
    "email address": "questions to billing@example.com",
    "currency amount": "total of EUR 312,45 payable",
    "invoice number": "reference 410772 is outstanding",
    "IBAN": "remit to DE02120300000000202051",
}

# Regression cases for three fail-open holes closed on 2026-08-11. Each one was
# proven live by execution before the fix; each must now be caught. These are
# STRUCTURAL — they plant an obvious leak in a shape the walker used to skip.
BURIED = "Erika Mustermann DE02120300000000202051 EUR 312,45 billing@example.com"
HOLES = {
    "subtree under a safe key": {"id": {"deep": {"note": BURIED}}},
    "list under a safe key": {"sha": [BURIED]},
    "value stored as a number": {"account": 572113790075},
    "leak parked in a key name": {BURIED: "ok"},
}

# Values the walker must NOT flag. A gate that refuses everything is not
# fail-closed, it is broken — and a false positive here permanently blocks the
# loop from writing, so these are as load-bearing as the leaks above.
CLEAN = {
    "machine ids": {"runId": "20260730-59375083", "idempotencyKey": "59375083ba057692"},
    "structural counts": {"chars": 8931, "lines": 156, "durationMs": 2267, "iterations": 1},
    "enum values": {"issuerKind": "cloud-provider", "docType": "vat-invoice"},
}


def wrap(text: str) -> dict:
    """Shape a candidate string like a real artifact so the walkers see it."""
    return {"nodes": [{"node": "act", "output": {"humanSummary": text}}]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inbox", default=str(HERE / "inbox"))
    parser.add_argument("--runs", default=str(HERE.parent / "data" / "loop-runs.json"))
    args = parser.parse_args()

    if not FIXTURE.exists():
        print(f"missing committed fixture {FIXTURE} — cannot build a deny-list", file=sys.stderr)
        return 1
    fixture_raw = FIXTURE.read_text(encoding="utf-8")
    forbidden = source_tokens(fixture_raw, vocabulary())

    failures = 0
    print(f"deny-list: {len(forbidden)} proper-noun tokens from {FIXTURE.name}")
    print(f"name gate: {len(redact.NAME_TOKENS)} tokens, "
          f"local file {'LOADED' if redact.LOCAL_TOKENS_LOADED else 'ABSENT (defaults only)'}\n")

    print("NEGATIVE — every line must be caught:")
    for label, text in LEAKS.items():
        hits = verify_clean(wrap(text)) + verify_no_source_tokens(wrap(text), forbidden)
        if hits:
            kinds = ", ".join(sorted({h.split(": ", 1)[-1].split(" ")[0] for h in hits}))
            print(f"  caught   {label:26} ({kinds})")
        else:
            print(f"  MISSED   {label:26} <-- sanitizer gap")
            failures += 1

    print("\nCLOSED HOLES — each was live before 2026-08-11:")
    for label, obj in HOLES.items():
        hits = verify_clean(obj) + verify_no_source_tokens(obj, forbidden)
        if hits:
            print(f"  caught   {label:26} ({len(hits)} finding(s))")
        else:
            print(f"  REOPENED {label:26} <-- regression")
            failures += 1

    print("\nFALSE POSITIVES — none of these may be flagged:")
    for label, obj in CLEAN.items():
        hits = verify_clean(obj)
        if hits:
            print(f"  FLAGGED  {label:26} <-- gate is over-firing: {hits[:3]}")
            failures += 1
        else:
            print(f"  clean    {label:26}")

    print("\nPOSITIVE — the committed artifact must be clean:")
    runs_path = Path(args.runs)
    if not runs_path.exists():
        print(f"  skipped  {runs_path} not present")
    else:
        record = json.loads(runs_path.read_text(encoding="utf-8"))
        # Check against the fixture deny-list always, and additionally against
        # every real inbox item when one is on this machine. The real item is
        # the stronger check; it just cannot be the only one.
        denylists = {"fixture": forbidden}
        inbox = Path(args.inbox)
        if inbox.exists():
            for item in sorted(p for p in inbox.iterdir() if p.is_file() and not p.name.startswith(".")):
                raw = item.read_text(encoding="utf-8", errors="replace")
                denylists[item.name] = source_tokens(raw, vocabulary())
        hits = verify_clean(record)
        for name, deny in denylists.items():
            found = verify_no_source_tokens(record, deny)
            if found:
                hits += [f"[{name}] {h}" for h in found]
        if hits:
            print(f"  DIRTY    {len(hits)} violation(s): {hits[:5]}")
            failures += 1
        else:
            print(f"  clean    {runs_path.name}  (deny-lists: {', '.join(denylists)})")

    print()
    if failures:
        print(f"FAILED — {failures} problem(s)")
        return 1
    print("PASSED — every leak caught, every hole still closed, artifact clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

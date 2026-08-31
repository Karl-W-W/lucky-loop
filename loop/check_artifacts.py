#!/usr/bin/env python3
"""Redaction gate for committed loop artifacts. Two positions, both real.

  .githooks/pre-commit  -> refuses the COMMIT   (install: git config core.hooksPath .githooks)
  npm prebuild          -> refuses the DEPLOY

WHERE THIS RUNS, AND WHY BOTH ARE NEEDED
----------------------------------------
This file was originally described as "the commit-boundary gate" while being
wired ONLY into `npm prebuild`. That is build time — and this project's builds
are GitHub-integration deploys, which run AFTER the push. On a PUBLIC repo the
push IS the publication, so the gate was reviewing bytes the world could already
read, and a leak would already be permanent in history. The gate was real; its
position was not what its name claimed. The hook is the position the name meant;
prebuild stays as the backstop for anyone who has not installed it.

WHY THIS EXISTS SEPARATELY FROM run.py's GATE
---------------------------------------------
run.py gates at RUN time, on the DGX. That is the right place for gate 2, which
needs the raw source document to build its deny-list. But it is the wrong place
to be the ONLY gate, because between the run and the publish there is a rsync
and a human `git commit`:

    ssh dgx 'python3 run.py …'      <- gate runs here
    rsync dgx:ll-loop/out/*.json data/
    git commit                      <- and nothing ran here

Anything that edits, truncates or hand-patches data/loop-*.json after the rsync
reached git unchecked. An adversarial pass on 2026-08-08 confirmed there was no
commit-time check of any kind: no git hook, no husky, no CI workflow, and a
prebuild that only regenerated the ledger and verified langflow anchors.

WHAT IT CAN AND CANNOT CHECK — THE VERDICT IS HOST-DEPENDENT
------------------------------------------------------------
Say this precisely, because "portable" was an overclaim. Gate 1 is patterns PLUS
the name deny-list, and the real names live in a gitignored file. So:

  on this Mac   -> patterns + REAL names        ("local deny-list LOADED")
  on Vercel     -> patterns + FICTIONAL names   ("ABSENT (fictional defaults)")

Those are different checks. The pattern half — email, IBAN, VAT-ID, card, phone,
amount, ref, digits, postcode — is genuinely portable and catches most shapes.
The by-name half is not, and cannot be without committing the deny-list, which
is the thing that was just removed for being a public inventory of the PII it
hides. The status line says which check ran; read it.

Gate 2 (verify_no_source_tokens) needs the source item, and loop/inbox/ is
gitignored. On a machine without the item its deny-list is EMPTY and the gate is
a silent no-op — it fails OPEN by absence. So it is best-effort here: applied
when an item happens to be present, never relied on. Do not "fix" that by
committing the inbox, and do not pad it with the synthetic fixture either (see
below — that poisons it with ordinary English at deploy-blocking blast radius).

Exit: 0 clean · 1 violations found (blocks the build) · 2 nothing to check.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

from redact import (  # noqa: E402
    LOCAL_TOKENS_LOADED,
    source_tokens,
    verify_clean,
    verify_no_source_tokens,
)

ARTIFACTS = [
    "data/loop-runs.json",
    "data/loop-def.json",
    "data/loop-status.json",
    "data/failure-status.json",
    # Derived agent liveness. It carries agent ids, a derived state and a short
    # evidence string — counts and states only, never a hostname, filename or
    # session id — but it is committed and rendered publicly like the rest, so
    # it is gated like the rest rather than trusted to stay clean.
    "data/agent-liveness.json",
]
# loop-status.json joined the list the same day it was created. It carries counts
# and timestamps only, by construction — but "by construction" is a claim about
# today's writer, and the gate is what keeps it true of every future one.


def main() -> int:
    checked = 0
    violations: list[str] = []

    # Belt and braces: the inbox must never become tracked. A committed real
    # item would defeat every gate downstream of it at once.
    inbox = REPO / "loop" / "inbox"
    tracked = []
    if inbox.exists():
        import subprocess

        out = subprocess.run(
            ["git", "-C", str(REPO), "ls-files", "loop/inbox"],
            capture_output=True, text=True,
        )
        tracked = [ln for ln in out.stdout.splitlines() if ln.strip()]
    if tracked:
        violations.append(f"loop/inbox is TRACKED by git: {tracked[:5]} — real items must never be committed")

    # Gate 2's deny-list, best-effort. Absent on any host without the item.
    # DELIBERATELY NOT the synthetic fixture. Gate 2's deny-list is "every
    # capitalised token in the SOURCE of this artifact" — and the fixture is not
    # the source of anything committed unless it was actually processed. Feeding
    # it in anyway deny-listed 10 ordinary English words (net, please, basic,
    # every, notes, reference, questions, meter, registered, billed), so a future
    # pass whose rationale said "Net amount due; please file the basic statement"
    # would fail this gate — and then fail EVERY subsequent deploy, including
    # docs-only ones, with a message that reads like a leak. A gate that cries
    # wolf at deploy-blocking blast radius gets disabled, which costs more than
    # it saves.
    forbidden: set[str] = set()
    try:
        from graph import vocabulary

        vocab = vocabulary()
        if inbox.exists():
            for item in sorted(p for p in inbox.iterdir() if p.is_file() and not p.name.startswith(".")):
                forbidden |= source_tokens(item.read_text(encoding="utf-8", errors="replace"), vocab)
    except Exception as exc:  # noqa: BLE001
        # Never let gate 2's unavailability mask gate 1. Report and continue.
        print(f"note: source-token deny-list unavailable ({type(exc).__name__}: {exc})", file=sys.stderr)

    for rel in ARTIFACTS:
        path = REPO / rel
        if not path.exists():
            print(f"  skip   {rel} (not present)")
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            # A corrupt artifact is a violation, not a skip: run.py's load_json
            # silently treats unparseable JSON as "no runs ever happened".
            violations.append(f"{rel}: unparseable JSON ({exc}) — refusing to publish")
            continue
        checked += 1
        found = verify_clean(payload)
        if forbidden:
            found += verify_no_source_tokens(payload, forbidden)
        if found:
            violations.extend(f"{rel}: {f}" for f in found)
            print(f"  DIRTY  {rel} — {len(found)} violation(s)")
        else:
            print(f"  clean  {rel}")

    print(
        f"\nname gate: local deny-list {'LOADED' if LOCAL_TOKENS_LOADED else 'ABSENT (fictional defaults only)'}"
        f" · source deny-list: {len(forbidden)} token(s)"
    )

    if violations:
        print("\nREDACTION GATE FAILED — refusing to publish:", file=sys.stderr)
        for v in violations[:20]:
            print(f"  {v}", file=sys.stderr)
        if len(violations) > 20:
            print(f"  … and {len(violations) - 20} more", file=sys.stderr)
        return 1
    if not checked:
        print("nothing to check")
        return 2
    print(f"OK — {checked} artifact(s) clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

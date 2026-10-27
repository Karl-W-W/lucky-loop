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
import re
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
    # The CI snapshot O3/KR3 is derived from (scripts/sync-ci.mjs). Public
    # GitHub metadata by construction — repo, workflow, run number, short sha,
    # time, conclusion — and since 2026-09-19 it is written UNATTENDED by the
    # nightly-queue job `ci-snapshot` and carried here by the artifact-return
    # hop. An artifact no hand touches between the API and the PR belongs in
    # this list more than one a human copies, not less.
    "data/ci-runs.json",
]
# loop-status.json joined the list the same day it was created. It carries counts
# and timestamps only, by construction — but "by construction" is a claim about
# today's writer, and the gate is what keeps it true of every future one.

# NAMED, VISIBLE EXEMPTIONS — two of them now. Read both reasons before adding a third.
#
# data/ci-runs.json repeats a GitHub repo slug on every row, and the owner half of a slug
# is an account name: `Karl-W-W/lucky-loop`. So the by-name half of gate 1 fires once per
# row — 33 times on the 2026-09-19 snapshot — on a file whose every byte came from the
# public API of a repository whose clone URL this very file's repo publishes.
#
# The part that makes it worth machinery instead of a shrug: this fires ONLY where the real
# deny-list is loaded, which is the loop host. CI runs the pattern half against fictional
# names and stays GREEN, while on the box artifact-return.py's run_gates() goes red, refuses
# its push, and takes the loop's own three artifacts down with it into a failures log nobody
# reads. Observed here 2026-09-19 in a post-merge rehearsal, before the branch landed —
# CLAUDE.md's "the verdict is HOST-DEPENDENT" with the signs reversed.
#
# What is waived is one RULE at one exact PATH, never a file: every other field of
# ci-runs.json, and every field a future schema adds, stays under both halves. Waivers are
# counted in the status line, so an exemption can never be silent. Verified 2026-09-19 by
# injecting a real deny-list token into $.runs[0].workflow — still DIRTY, still exit 1.
#
# ITS LIMIT, said plainly: the waiver covers the whole `repo` value, so a name smuggled INTO
# a slug (`Karl-W-W/<name>-notes`) passes. That is accepted, not overlooked — a slug is chosen
# by the account owner and is public the moment the repository is, and narrowing the waiver to
# one literal string would hard-code an account name into a world-readable file, which is the
# exact trade the gitignored deny-list exists to refuse.
#
# SECOND ENTRY, 2026-10-12 — ci-runs.json's `digits` rule at $.runs[n].sha7.
#
# The same shape of failure as the first entry, found the same way: on the box, not in CI.
# `sha7` is `String(head_sha).slice(0, 7)` in scripts/sync-ci.mjs, i.e. a short SHA out of the
# public GitHub API, and a short SHA is hexadecimal — so roughly one commit in 27 ((10/16)^7)
# has one written only with decimal digits. The `digits` rule is \b\d{6,}\b, which reads any
# such row as a 6+-digit identifier. ONE row of 39 in the 2026-09-27 snapshot was one, and that
# one field refused every artifact-return run from 2026-09-28T02:35:03Z onward — 701 consecutive
# red runs, 4 loop passes held on the host — while CI stayed green, because CI runs the pattern
# half and that half fires here too but the courier is the only thing that acts on it.
#
# What is waived is one RULE at one exact PATH, and ONLY when the value has the shape of a short
# SHA: exactly 7 lowercase hex characters. That is why apply_exemptions() takes the parsed
# payload — it resolves the violation's path back to its value, and it FAILS CLOSED, keeping the
# violation whenever the path does not resolve or the value is any other shape. Every other rule
# at sha7 (an e-mail parked there stays a violation), the digits rule at every other path, and
# every other artifact are untouched. Waivers are counted in the status line, as above.
#
# ITS LIMIT, said plainly: a 7-digit NUMBER written into sha7 would pass the digits rule under
# this waiver, because 7 decimal digits are also 7 lowercase hex characters — the shape test
# cannot tell a short SHA from a 7-digit invoice reference. What bounds that is the writer:
# only scripts/sync-ci.mjs writes this field, from the public API's head_sha. A different writer
# at this path is a reason to revisit this entry, not to widen it.
#
# NOT DONE, deliberately: `sha7` is NOT added to redact.py's SAFE_KEYS. That set exempts a key's
# whole scalar value from EVERY rule in EVERY artifact, so it would also waive an e-mail, an
# IBAN or a deny-listed name stored under any field named sha7 anywhere. The narrow fix is here.
EXEMPT: dict[str, list[tuple[re.Pattern, str, "object | None"]]] = {
    "data/ci-runs.json": [
        # $.gates[0].repo, $.runs[12].repo — the slug of a public repository, not a person.
        (re.compile(r"^\$\.(gates|runs)\[\d+\]\.repo$"), "name", None),
        # $.runs[34].sha7 — a short SHA that happens to carry no hex letters.
        (re.compile(r"^\$\.runs\[\d+\]\.sha7$"), "digits", lambda v: _is_short_sha(v)),
    ],
}

SHORT_SHA_RE = re.compile(r"^[0-9a-f]{7}$")


def _is_short_sha(value: object) -> bool:
    """True only for exactly 7 lowercase hex characters, as a string."""
    return isinstance(value, str) and bool(SHORT_SHA_RE.match(value))


# Walker paths look like `$.runs[34].sha7`. Key findings look like `$.runs[34].<key 'sha7'>`,
# which this deliberately cannot resolve (there is no such key), so they fail closed.
_PATH_STEP = re.compile(r"\.([^.\[\]]+)|\[(\d+)\]")
_UNRESOLVED = object()


def resolve_path(payload: object, at: str) -> object:
    """Value at a walker-produced JSON path, or `_UNRESOLVED`. Never raises."""
    if not at.startswith("$"):
        return _UNRESOLVED
    pos = 1
    cur: object = payload
    while pos < len(at):
        step = _PATH_STEP.match(at, pos)
        if not step:
            return _UNRESOLVED
        key, index = step.group(1), step.group(2)
        if index is not None:
            if not isinstance(cur, list) or int(index) >= len(cur):
                return _UNRESOLVED
            cur = cur[int(index)]
        else:
            if not isinstance(cur, dict) or key not in cur:
                return _UNRESOLVED
            cur = cur[key]
        pos = step.end()
    return cur


def apply_exemptions(
    rel: str, found: list[str], payload: object = None
) -> tuple[list[str], list[str]]:
    """Split `path: kind` violations into (kept, waived) for one artifact.

    A rule whose third element is not None is VALUE-CONDITIONAL: the path is
    resolved against `payload` and the violation is kept unless the value passes.
    Omitting `payload` therefore waives nothing conditional, which is the safe
    direction.
    """
    rules = EXEMPT.get(rel)
    if not rules:
        return found, []
    kept: list[str] = []
    waived: list[str] = []
    for v in found:
        at, _, kind = v.rpartition(": ")
        exempt = False
        for pat, k, value_ok in rules:
            if kind != k or not pat.match(at):
                continue
            if value_ok is None:
                exempt = True
                break
            value = resolve_path(payload, at)
            if value is not _UNRESOLVED and value_ok(value):
                exempt = True
                break
        (waived if exempt else kept).append(v)
    return kept, waived


def main() -> int:
    checked = 0
    waivers = 0
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
        found, waived = apply_exemptions(rel, found, payload)
        waivers += len(waived)
        note = f" ({len(waived)} exempt)" if waived else ""
        if found:
            violations.extend(f"{rel}: {f}" for f in found)
            print(f"  DIRTY  {rel} — {len(found)} violation(s){note}")
        else:
            print(f"  clean  {rel}{note}")

    print(
        f"\nname gate: local deny-list {'LOADED' if LOCAL_TOKENS_LOADED else 'ABSENT (fictional defaults only)'}"
        f" · source deny-list: {len(forbidden)} token(s)"
        f" · {waivers} named exemption(s) applied (EXEMPT, top of this file)"
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

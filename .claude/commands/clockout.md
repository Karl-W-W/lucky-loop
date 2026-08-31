---
description: Close a work session — write the dated handoff, log to the vault, settle background work, report final state, stop
argument-hint: "[date] (optional, e.g. 2026-08-31; defaults to today)"
---

# Clockout

Close the session so the next one can start from facts instead of memory.

`DATE` = `$1` if given, else today's real date — **read the clock, do not assume it.**

## 1. Write `docs/handoffs/<DATE>.md`

**This file is in a PUBLIC repo.** No hostnames, addresses, tunnel names, key
fingerprints, auth URLs, real personal names, mail subjects or commit SHAs that point at
a known exposure. Redact BEFORE writing, never after — the push is the publication.

Open with: *"Written for the next session. **Every claim here is a hypothesis.**"*

Then exactly these sections:

- **SHIPPED (with numbers)** — what actually landed, each with the measurement that
  proves it. No entry without a number or a verified state. Deployed-and-verified beats
  merged.
- **PRINCIPLES** — rules ratified today, numbered, each with the incident that produced
  it. A principle with no incident behind it is a preference.
- **OPEN DECISIONS** — what is waiting on Karl. Options + recommendation + what it costs.
  Carry any unchanged checklist forward verbatim rather than paraphrasing it.
- **IN FLIGHT** — anything still running: pid, ppid, session, what it is chained to fire,
  where it logs, and **THE ONE MORNING CHECK COMMAND** in a fenced block, with the
  expected output and what each other outcome means. State plainly what is *not* yet
  known, so no verdict gets reported that does not exist.
- **DATED PREDICTIONS** — each with a date, the mechanism, and **what would falsify it.**
  An unfalsifiable prediction does not go in.
- **SHORTLIST** — next session's candidates, ordered, with the hard constraint restated:
  at least half outsider-visible or moves a D grade.
- **CORPSES — claims that died on contact today** — every inherited or self-made claim
  that proved false, what the real state was, and how it was caught. **This section is
  not optional and an empty one is suspicious.** It is the most valuable part of the file.

## 2. Log to the vault

Append a session entry via `~/brain/tools/brain-log.py` — **never** by editing
`~/brain/log.md` directly (it is append-only). Record decisions and outcomes, including
the negative results. A negative result that is not logged will be re-derived.

## 3. Settle background work — detach or kill

Enumerate everything this session started. For each, decide **detach or kill**, and say
which:
- **Detach** only if it survives a closed laptop: `PPID 1`, its own session, no tty, its
  own log, and a check command already written into IN FLIGHT.
- **Kill** anything that would be orphaned, half-finished, or that holds a lock.

Never leave an unnamed process behind.

## 4. Queue the commits

Stage and commit the session's work. **Do not push without Karl's explicit
authorisation, and authorisation is per-SHA** — work approved after he named the SHAs is
not covered by that approval. If a commit was created after authorisation, say so and
leave it unpushed. Run the gates before committing (the pre-commit hook refuses the
commit; `prebuild` refuses the deploy).

## 5. Final state + stop

One short block, no prose:
- Commits made / pushed / awaiting authorisation (by subject, not SHA where a SHA is sensitive)
- Deployed URL verified, or explicitly not
- Processes left running, with their check command
- What the next session must do first

Then **stop.** Do not start new work after the handoff is written — anything begun after
it is unrecorded, and unrecorded work is how a clean local tree hides work that never
left the machine.

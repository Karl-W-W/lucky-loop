---
description: Open a work session — reconstruct the gap since the last clockout, then present a decision stack and wait
argument-hint: "[since-date] (optional, e.g. 2026-08-28; defaults to the newest file in docs/handoffs/)"
---

# Clockin

Fresh session. Reconstruct reality, then stop and let Karl choose.

**The governing rule: every claim is a hypothesis.** Inherited claims die on contact
routinely — five died in a single session on 2026-08-28. Verify instead of believing,
including claims made by this file. `uninstrumented ≠ failed`. Liveness of a checker is
not liveness of the thing checked. A control-plane probe that returns success regardless
of whether data crosses is not evidence.

## Setup

1. `SINCE` = `$1` if given, else the newest date in `docs/handoffs/`
   (`ls docs/handoffs/ | sort | tail -1`). `NOW` = today's real date and local time —
   read it, never assume it. Misreading the clock has already produced a false
   "there was an overnight" corpse.
2. Read, in this order, before asserting anything:
   - `docs/handoffs/<SINCE>.md`
   - `CLAUDE.md` (and `AGENTS.md`)
   - vault session events since `SINCE` (gbrain MCP, read-only tools)
   - the applied `mail-triage.yaml`
3. Note the elapsed wall-clock gap explicitly. If it is under a few hours, say so —
   "nothing ran overnight because no night occurred" is a real finding.

## PHASE 1 — reconstruct the gap

One table. Every row cites the command that produced it.

1. **Activity in the gap.** `git log --all --since=<SINCE>` in every active repo
   (lucky-loop, loop-factory), plus `git reflog`, `git status`, stray handoff files,
   vault events, and any other Claude sessions on either machine. If sessions ran,
   summarize them before anything else.
2. **Push state.** For each repo: is local HEAD on the remote?
   `git rev-list --left-right --count origin/<branch>...HEAD`. Name the branch topology
   precisely — a local branch tracking a differently-named remote default publishes
   nothing. Anything Karl authorized and that is still local: push it (public push =
   publication; his authorization is required and is per-SHA, not standing).
3. **The DGX.** `ssh dgx-remote`. Scheduler ticks fired? Units still up after the idle
   stretch? Zombies, orphaned PIDs, disk after any large download? Report RAM/CPU
   footprint of anything newly staged. Read-only unless Karl approves a change.
4. **Nightly `claude -p` queue.** One row per scheduled run in the window: fired?
   exit code? new `agent_events` rows? Does the floor render them? Do Inspector
   classifications hold on fresh real data — no fixture pollution, no false failures?
   A null result ("the loop is alive and starving") is a legitimate finding.
5. **mail-triage.** Real mail through the carve-out in the window: which rules fired,
   any misroutes, `send_violations` (must be 0). **Shape and routing only — never
   content.** A subject line is a document title.
6. **Infra.** Tunnel health across the window; mesh networking; the Mac→DGX ssh forward
   (a sleeping laptop kills it — test the ports, do not trust the process list); any
   dated prediction whose window is now near; gates green in lucky-loop
   (`npm run check:redaction`, `npm run check:flow`, MCP invariant).

## PHASE 2 — decision stack, then STOP

Present each open decision as: **options → your recommendation → cost/blast radius →
what would falsify it.** Then **WAIT.** Do not execute Phase 2 items.

Karl's hand stays on: **root, secrets, purchases, public pushes.** Do the legwork so he
only has to say yes — candidates priced, checklists pre-run, the exact one-line change
identified — but he makes the call and, where it is his hand, performs it.

## PHASE 3 — sign-off shortlist

Reorder the shortlist against what Phase 1 surfaced, then state the reorder and why.

**Hard constraint: at least half the shortlist must produce something an outsider can
see, or move a D grade. Audit-only items are rejected by default.** A dated prediction
whose window is closing outranks work that can ship any week — a falsifiable moment is
wasted the day after it lands.

## Standing rules (unchanged, re-read every session)

- `delegation.high = []`
- No yaml without a roster entry
- Red-test both failing states before an indicator ships
- Negative results get logged
- Bias to ship; commit + push after every working increment; verify the DEPLOYED URL
- Never raise a score to flatter the work

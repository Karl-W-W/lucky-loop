# Finding — an indicator whose failing state was unreachable

**Date:** 2026-08-28
**Status:** OBSERVATION ONLY. No remediation is claimed, and nothing here is fixed.

## What was observed

A second, independent route to the DGX has been carried as the documented
fallback for the case where the primary tunnel is down. The routine check used
to confirm it was a control-plane reachability probe — the obvious command, the
one the tooling offers first.

Measured 2026-08-28 by A/B: the same probes run with the fallback route broken,
then again with the single interfering component disabled.

| Signal | Route broken | Route working |
|---|---|---|
| control-plane probe | success | success |
| OS-level ping (data path) | 100% loss | 0% loss |
| session handshake timestamp | epoch zero — never | current |
| bytes to peer (tx / rx) | 0 / 0 | non-zero, rising |
| interactive login | connection timeout | established, key exchange completed |

**The probe returned indistinguishable success in both states.** It rides the
control plane and is exempt by design from the data path it appears to test. Run
alone, it cannot fail for the reason that mattered.

The load-bearing number is the handshake timestamp. It read epoch-zero, meaning
the data session had never once been established since the peer was added — the
fallback had not been working and then broken. **It had never worked.** Weeks of
routine green said otherwise, and no reading available to the routine check
could have said so.

Cause, once isolated: a commercial VPN client on the laptop, whose network
extension silently discards the mesh route's data-plane traffic while leaving
its control-plane traffic intact. That is what makes the false green so stable —
the interference lands precisely on the half the probe does not exercise.

## Why this belongs on the failure surface

It is the same defect class as the day-after rule already recorded in
`CLAUDE.md`: `daysUntil()` clamped with `Math.max(0, …)`, so for five days after
the deadline the page announced a launch that had already happened, because
"overdue" was not a state the value could hold.

Both are derived indicators whose failing state was **unreachable**:

- the clamp made the failing state unrepresentable in the value's range;
- the probe made it unreachable by exercising a different path than the one
  under test.

Neither was green because the system was healthy. Both were green because the
check could not express ill health. A check that cannot fail is not a check —
it is a decoration that costs more than nothing, because it displaces the one
that would have failed.

The routine also inverted the usual risk: the fallback is consulted **only**
during an incident, so the first real read of a route believed good for weeks
would have come at the exact moment the primary was already gone.

## The rule

**No indicator ships unless its failing state is reachable and has been
demonstrated.**

Demonstrated means someone has watched it go red on purpose — broken the thing
it watches and confirmed the reading changed. An indicator whose red state has
never been seen is an untested branch that runs only in production, only during
an incident.

Applied to a panel: for every tile, name the state it shows when the underlying
array is empty, and the state it shows after the boundary has passed. If either
answer is "the same thing it shows when healthy", the tile is not ready.

Applied to a check: pair the probe with a reading that moves — a byte count, a
timestamp, a completed session. Liveness of the checker is not liveness of the
thing checked.

## Scope and limits

- Observation only. The cause is identified and confirmed by A/B; the fix is
  not deployed, and the fallback route is **not** currently usable in the
  machine's normal configuration.
- The finding is about the **check**, not the route. Repairing the route would
  not repair the reason nobody knew it was broken.
- No panel renders this yet. It is recorded so it stops being rediscovered.

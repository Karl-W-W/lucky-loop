# Autonomy — the chain from a bill in the mail to a number on /war

Written 2026-09-05 against the brief "Lucky Loop feeds itself and publishes itself".
Public repo: no hostnames, tunnel names or credentials appear here. "The loop host" is
the box that runs the timer; "the Mac" is the laptop that holds the only GitHub credential.

## The chain, hop by hop

| # | Hop | Runs where | Cadence | Automated since | Still a human hand? |
|---|-----|-----------|---------|-----------------|---------------------|
| 0 | Mail → `captures/bills/<date>-bills.md` in the vault (bills-to-vault) | loop host | nightly | 2026-09-05 via iCloud, per the brief | The credential. The Gmail path is BLOCKED on an expired OAuth (Today page, 2026-09-04); re-authorising a mail credential is always a hand at a browser. |
| 1 | Vault bills → `item-NNN.txt` in the loop inbox (feed-from-bills) | loop host | nightly (assumed) | being built by another agent today; NOT verified here | Until it lands: `npm run feed:loop -- --yes` on the Mac, which is a declared human step. See "the control this removes" below. |
| 2 | Loop pass: perceive → decide → act → evaluate → adapt, artifact + gates at run time | loop host | timer, every 10 min | 2026-08-11 | No. Idle ticks (exit 4) are the resting state. |
| 3 | Writeback: `source=loop` decision + outcome events into the vault | loop host | per pass | 2026-08-11 | No. |
| 4 | Artifact return: host `out/` → `data/` → commit → push | the Mac | every 6 h | **2026-09-05, `loop-publish`** — agent loaded, dry run green; the install into `~/.local/bin` and the first real run are a needs-you item, because the agent that built it was refused both by the permission gate | Once, to install it. Then only when a gate is red, or the Mac is asleep. |
| 5 | Deploy: push → Vercel prebuild gates → build | Vercel | per push | 2026-07 | No. Prebuild runs the pattern half of the name gate only; the Mac ran both halves at hop 4. |
| 6 | /war and /loop render committed JSON at build time | Vercel | per deploy | 2026-07 | No. Numbers are frozen at build; `syncedAt` is rendered beside every one. |

## Hop 4: why a Mac launchd job, not the vault as a relay

Two designs were on the table. **Chosen: a launchd agent on the Mac** (`deploy/loop-publish.sh`,
installed as `~/.local/bin/loop-publish`, scheduled by `deploy/com.kww.loop-publish.plist`,
label `com.kww.loop-publish`, every 6 h).

- **The gate's strong half lives where the push happens.** The Mac holds the gitignored
  name deny-list, so `loop-publish` runs redaction (patterns AND names), the redaction test
  suite, and the drift gate before a single byte leaves the machine. Vercel and CI can
  only run the pattern half.
- **The alternative adds a copy and removes nothing.** Having the loop host write the
  artifact into the vault and a Mac job publish from there still needs the Mac (the host
  never holds a GitHub credential and never sends, by rule), still needs the same gates,
  and leaves a second copy of a mail-derived artifact in the vault that nothing consumes.
- **Cost accepted:** the Mac is a laptop. launchd does not fire while the lid is closed; a
  missed interval fires on wake. While the Mac travels, /war's panel crosses its 24 h line
  and reads "Snapshot stale" — that is the designed state, not a fault. The loop host
  keeps running and nothing is lost; the next run publishes everything at once.

What `loop-publish` does, in order: refuse unless on a clean `main` that has no unpushed
human commits (fast-forwards if behind); `npm run sync:loop`; discard the fresh snapshot
and stop if no pass is new and the committed snapshot is under 12 h old (idempotence);
regenerate the canvas (node titles derive the pass count, so a new pass would otherwise
fail the drift gate); run the three gates; commit exactly the three data files plus the
canvas; push; verify the push landed. **A red gate restores the committed bytes and
pushes nothing, not even a branch** — the brief said "otherwise push a branch", but on a
public repo a branch push is a publication, so the bytes stay on the Mac and the log
line names the gate. One line per run in `~/.config/loop-publish.log`. `--dry-run`
does everything but commit and push, and logs what would have shipped. First line ever
written, 2026-09-05, from a dry run:

```
2026-09-05T15:02:17Z fetched=3 new=0 gates=green pushed=no reason=dry-run(would-publish:status snapshot)
```

## The control this removes — read before enabling hop 1

Until today, choosing which document entered the inbox was the last human control on a
path that ends on a public website (CLAUDE.md, "Hop 0 is a GATE"). With hop 1 automated
AND hop 4 automated, no hand touches a document between the mail server and prod. What
remains are the gates: gate 1 + gate 2 at run time on the host, both halves again on the
Mac before commit, the pattern half again on Vercel and in CI. The gates have been shown
fail-open once. The feeder must therefore feed ONLY admin documents (the loop's enums are
an admin triage vocabulary) and never a realm document, and the first week of unattended
publishing should be read by a person daily, from the log and from `/loop`.

## Provenance: the next hop, not built

`data/loop-runs.json` carries no field that says whether a human or the feeder placed
the item. `item.source` is the constant string `loop/inbox (gitignored)`, `vault.source`
is `loop`, and `trigger` is `schedule` or absent — none distinguishes the feed. So the
pages render no "fed by" line today; a line derived from nothing would be a hand-typed
number with a green check beside it. Next hop: the feeder writes a sidecar beside
`item-NNN.txt`, `run.py` copies it into `item.fedBy` (`"human"` | `"feed-from-bills"`),
the key is added to the graph vocabulary allow-list, and only then do `/loop` and `/war`
render it. That changes the artifact shape, so the redaction tests grow a case first.

## Human hops that remain, and why

1. **Re-authorising a mail credential** — a browser and a person, by the vendor's design.
2. **Anything a gate refuses** — the bytes stay on the Mac; the log names the gate.
3. **Waking the Mac** — hop 4 needs it awake and on the network. Not a bug; a laptop.
4. **The provenance field** above — a shape change with a test, not a page edit.
5. **Closing needs-you items** — agents add, only Karl closes (O4/KR2).

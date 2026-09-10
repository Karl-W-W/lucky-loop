# Autonomy — the chain from a bill in the mail to a number on /war

Written 2026-09-05 against the brief "Lucky Loop feeds itself and publishes itself".
Public repo: no hostnames, tunnel names or credentials appear here. "The loop host" is
the box that runs the timer; "the Mac" is the laptop that holds the only GitHub account credential.
Since 2026-09-10 the Mac is out of the chain — see "Hop 4".

## The chain, hop by hop

| # | Hop | Runs where | Cadence | Automated since | Still a human hand? |
|---|-----|-----------|---------|-----------------|---------------------|
| 0 | Mail → `captures/bills/<date>-bills.md` in the vault (bills-to-vault) | loop host | nightly | 2026-09-05 via iCloud, per the brief | The credential. The Gmail path is BLOCKED on an expired OAuth (Today page, 2026-09-04); re-authorising a mail credential is always a hand at a browser. |
| 1 | Vault bills → `item-NNN.txt` in the loop inbox (feed-from-bills) | loop host | nightly (assumed) | being built by another agent today; NOT verified here | Until it lands: `npm run feed:loop -- --yes` on the Mac, which is a declared human step. See "the control this removes" below. |
| 2 | Loop pass: perceive → decide → act → evaluate → adapt, artifact + gates at run time | loop host | timer, every 10 min | 2026-08-11 | No. Idle ticks (exit 4) are the resting state. |
| 3 | Writeback: `source=loop` decision + outcome events into the vault | loop host | per pass | 2026-08-11 | No. |
| 4 | Artifact return: host `out/` → private mirror → Action → PR → `data/` | loop host (stage, every 30 min) + GitHub Actions (every 6 h) | see left | **2026-09-10, `artifact-return`** — Karl's word: action, overriding the council's mac; replaces the Mac's `loop-publish` (in service 2026-09-05 → 2026-09-10, two unattended publications) | **Yes, one tap: the merge.** On a public repo the merge is the publication (rule 3). Plus anything a gate refuses. |
| 5 | Deploy: push → Vercel prebuild gates → build | Vercel | per push | 2026-07 | No. Prebuild runs the pattern half of the name gate only; the Mac ran both halves at hop 4. |
| 6 | /war and /loop render committed JSON at build time | Vercel | per deploy | 2026-07 | No. Numbers are frozen at build; `syncedAt` is rendered beside every one. |

## Hop 4: host → private mirror → Action → PR (since 2026-09-10)

Karl's word on 2026-09-10 was **action**, overriding the council's recommendation of **mac**
(captures/council/council-artifact-hop-off-the-mac.md in the vault; the dissent named the reason:
a closed lid kills O3 silently and nothing watched the hop). Logged as the decision
`hop:artifact-return-action-2026-09-10`. The council's builder conditions are all in force; none
is optional, and each is code, not intent:

1. **A dedicated PRIVATE mirror, `lucky-loop-artifacts`, holding only the redacted files** — never
   a key to the vault mirror in a public repo's secrets. The loop host pushes there over a write
   deploy key scoped to that one repo; that key exists by council verdict (Karl's override counts
   as the verdict the rule of 2026-09-08 requires). The public repo holds the mirror's READ-only
   half as the secret `ARTIFACT_MIRROR_KEY`. Nothing on the loop host can write to this repo.
2. **Actions logs are public.** The job clones `--quiet`, prints counts and verdict words, never
   a diff, never content.
3. **`gate.json` fails closed.** `deploy/artifact-return/artifact-return.py` runs the redaction gate
   and its tests on the host, in a dedicated clone of this repo reset to `origin/main` with the real
   deny-list linked in, and writes `{gate, nameTokens, sha256, at}`. `scripts/artifact-return-verify.py`
   refuses when the file is absent, the gate is not `strong`, the token count is below a floor, a
   sha256 differs, or the attestation is older than the newest pass. It is an **attestation by the
   host that wrote the artifact**, bounded by the runner — never called "passed" there.
4. **Run-count floor**, twice: on the host against the mirror's last copy, in the Action against
   the committed copy. Published history never shrinks on the word of one host.
5. **Schedule is best-effort** and GitHub disables it after 60 idle days: `workflow_dispatch`
   exists and a keepalive step re-enables the workflow on every run.
6. **A PR, not a push.** Rule 3 — nothing outward without Karl's hand — is intact because the
   merge is the publication. Karl merges from the phone. `auto` (push to main) would need a rule
   amendment and only Karl's word can open that.
7. **Docs and canvas**: this section, CLAUDE.md, AGENT-OS §1/§7 in the vault, and a derived canvas
   node whose two cadences are READ from `deploy/artifact-return.timer` and the workflow's cron.
8. **Keys via `gh` from the Mac**, both generated 2026-09-10; the Action's private half never
   touched disk outside the secret store for longer than the command that stored it.

Also from the risk review: the host's trigger is a **content hash on a timer**, not inotify
(`out/loop-runs.json` was once touched with no pass behind it); actions are **pinned by commit
SHA**; a refused host run is a unit **failure** on purpose, so `lucky-loop-failed@.service` writes
the dead-man's failure log and `loop-status.json` carries it to /war as `lastFailureAt`. Two
heartbeats cover the two halves in the vault's registry: `artifact-return` (the host beats every
run) and `artifact-return-action` (the host mirrors the Action's last successful run from the
public API into a beat file, so a silent Action shows up in KR-0 the same way a silent host does).

What the host does, in order: beat; probe the Action; read `out/`; refresh the mirror; refuse a
shrinking pass count; stop if nothing is new and the mirror's snapshot is under 12 h old; run the
gates in the gate checkout; refuse anything but `strong`; write exactly four files into the
mirror and refuse if any other path is dirty; commit; push `HEAD:main` only; verify the push landed.
One line per run in `~/.local/state/lucky-loop/artifact-return.log`. `--dry-run` does everything
but commit and push.

What the Action does, in order: clone the mirror with the read key and GitHub's pinned host key;
verify; copy the three files; regenerate the canvas; redaction (pattern half) and its tests; drift
gate; `npm ci && npm run build` (prebuild re-runs every gate the deploy runs); commit on
`loop/artifact-return`; force-push that branch; open or update the PR; keepalive; an honest step
summary. `gates.yml` runs on the PR as well — observed 2026-09-10 on PR #2, which the Action opened
itself — so the PR carries its own check besides the gates the job ran; it runs again on `main` after
the merge. (The first draft of this paragraph claimed the opposite from GitHub's token rule; the run log won.)

State on 2026-09-10: **Beta until the first PR opened by the Action is merged.** Reload the Mac's
retired job only as a fallback, and only while the Action is broken:
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kww.loop-publish.plist`.

### Until 2026-09-10: the Mac launchd job

The first automation of this hop was a launchd agent on the Mac (`deploy/loop-publish.sh`,
installed as `~/.local/bin/loop-publish`, scheduled by `deploy/com.kww.loop-publish.plist`,
label `com.kww.loop-publish`, every 6 h), chosen on 2026-09-05 because the Mac held the name
deny-list and the only GitHub credential. It published twice unattended (a status snapshot on
2026-09-08 and passes 4–5 on 2026-09-09, canvas regenerated) and was unloaded on 2026-09-10
when Karl's word moved the hop off the Mac. Its accepted cost — launchd does not fire while the
lid is closed — was the reason. The script and the plist stay versioned as the fallback above.

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
3. **Merging the PR** — one tap from the phone. This is the hand rule 3 requires; it replaced
   "waking the Mac" on 2026-09-10.
4. **The provenance field** above — a shape change with a test, not a page edit.
5. **Closing needs-you items** — agents add, only Karl closes (O4/KR2).

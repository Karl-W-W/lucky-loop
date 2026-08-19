# Lucky Loop

**Product:** Lucky Loop is an agent harness for Claude Code with a visual War
Room, aimed at non-technical builders. This repo is both the product and the
dashboard we run the company on.

> **THIS REPO IS PUBLIC** (flipped 2026-08-05 after a clean `gitleaks detect
> --log-opts="--all"`; `REPO_PUBLIC` in `app/war/data.ts` and the real GitHub
> visibility must always move together). Everything you commit — code, data
> files, commit messages, author emails — is world-readable immediately. The
> SANITIZE rule was already binding because prod renders committed JSON
> publicly; it is now binding twice over. Redact BEFORE commit, never after.
> Never `git push --tags` or `--follow-tags`: the local tag
> `archive/mac-scaffold-2026-07-22` must never reach origin, because a public
> repo serves unreachable objects by SHA and that would be irreversible.

## /war — the War Room

`/war` shows **real data only — no mock telemetry**:

- **OKR / KPI progress bars** from `data/okrs.json` (versioned in git).
  Seed: O1 "Launch Lucky Loop MVP — Jul 31"; KRs "War Room live on Vercel",
  "Loop runs end-to-end". Update progress by editing the JSON and committing.
- **Growth Ledger** — merged feed of git commits + Vercel deploys, newest
  first. Commits come from build-time `git log` via `scripts/gen-ledger.mjs`
  (npm `prebuild`), written to `data/ledger.json` and committed so file-based
  deploys include it. Deploys are appended to `data/deploys.json` at each
  deploy (entry: `{ t, url, target, sha }`).
- **Flow panel** — rendered FROM `data/loop-def.json`, which is DERIVED from the
  compiled LangGraph via `get_graph()` on every run. The placeholder was retired
  by a real definition (2026-07-30), so the diagram cannot drift from the code
  that ran. Never hand-edit `loop-def.json`.
- **Links rail** — from `data/links.json` (edit there, not in components). Rows
  with `"requiresPublicRepo": true` were hidden while the repo was private; now
  that it is public they render, so a broken GitHub URL is a visible 404 rather
  than a silently-dropped row. Only 2 of the 6 links CLAUDE.md originally
  imagined exist — Vercel/Supabase/Phoenix/GBrain rows have never been added.
  The second row used to be "Live site", which pointed at the site you were
  already on: a rail whose only job is to send you elsewhere, spending half its
  rows on a loop back to itself. It is now the committed run artifact.

## The day-after rule (learned the hard way, 2026-08-05)

`daysUntil()` clamped with `Math.max(0, …)`, so for five days after the Jul 31
deadline `/war` announced **"Days to MVP: TODAY · 0 days left"** about a launch
that had already happened. A derived value entered a state it could never leave.

**Every computed display needs a defined state for after the boundary, and for
the empty case.** `dueState()` in `app/war/data.ts` is the pattern: it returns
`ahead | due-today | met | overdue` and the render sites switch on the kind, so
"the day after" is a state the page can render rather than a number it clamps.
Completion outranks the calendar. When you add a tile, ask what it shows when
the array is empty and when time has passed with no new data.

## /loop — the product

`/loop` renders real recorded passes from `data/loop-runs.json`. The loop itself
is Python + LangGraph in `loop/`, run on the DGX (`~/ll-loop`) against a local
Ollama model — **not** on Vercel, which has no Python runtime. Artifacts are
redacted by two gates (a PII-pattern gate and a provenance gate that deny-lists
every capitalised token in the source), then committed by a human. `loop/inbox/`
is gitignored and must never be committed — it holds real mail and bills.

**Closed 2026-08-11** (this replaces the "run exactly once, never unattended,
never wrote back" gap): a `systemd --user` timer on the DGX
(`deploy/lucky-loop.*`, `Linger=yes`) fired `lucky-loop.service` at 15:40:01
CEST with nobody watching, processed a second document, and `loop/writeback.py`
emitted the first `source=loop` decision+outcome events the vault has ever held
(`loop:28af40a361779323`) and pushed them itself. `pick_item`/`consume_item` are
a real queue now — processed items move to `.done/`, so the loop advances
instead of re-picking file one forever.

**What is still thin, do not paper over it:** the corpus is TWO documents, and
one of them is `loop/fixtures/synthetic-bill.txt`, written to exercise the
gates. So generalisation across real document types remains unproven, and
`llama3.2:3b` misclassified that fixture's fictional electricity supplier as
`issuerKind: cloud-provider` — the pass converged only because
`bill_has_amount` does not depend on `issuerKind`. Copy on the site must not
imply breadth this does not support; `/` deliberately makes no claim about
*what* the passes ran on, and `/loop` carries the composition.

## Style

Keep the current dark command-center look: tokens live on `.war-root` in
`app/globals.css` (validated dataviz palette — series blue/orange, status
colors reserved for state, ink/grid/surface tokens). Charts follow the specs
already in the components: 2px lines, ≥8px markers with surface rings,
hairline solid gridlines, text in ink tokens never series colors, tables as
the no-hover fallback.

## Build

`npm prebuild` runs three things, in order:

1. `scripts/gen-ledger.mjs` — regenerates `data/ledger.json` from `git log`.
   It refuses to write on a shallow checkout or when the commit count regresses.
   **It loses on Vercel** (shallow checkout it cannot deepen without
   credentials), so prod ships the committed commit list with a fresh
   `builtAt`. That is fine and is now *disclosed*: `isLedgerFromGit()` reads the
   `source` field the script always wrote and nothing ever read, and the /war
   stamp says "commits from a committed snapshot of <date>" instead of
   asserting "from git + Vercel" on data that did not come from git.
2. `python3 loop/check_artifacts.py` — the **redaction gate at the commit
   boundary**. `run.py` gates at run time on the DGX, but between the run and
   the publish sit an rsync and a human commit, and nothing checked there.
   Gate 1 is portable and always runs; gate 2 needs the source document and is
   best-effort by construction. Run alone with `npm run check:redaction`.
3. `python3 langflow/gen-flow.py --check-drift` — the **drift gate**. It
   regenerates the canvas and compares it to the committed
   `lucky-loop-architecture.json`, naming the drifted nodes.

   `--check` (still available as `npm run check:flow`) is the weaker **anchor**
   gate: it proves 40 file+regex anchors resolve and says nothing about whether
   the canvas is current. That distinction was not academic — the committed
   canvas embedded `REPO_PUBLIC = false` for three days after the source read
   `true`, with `--check` green throughout. `prebuild` now runs the strong one.
   **If a deploy ever fails here during an incident**, the escape hatch is to
   drop the failing `&& python3 …` from `prebuild` and ship; then fix it.

**The redaction gate now has two positions**, because the first one was wrong:
`.githooks/pre-commit` refuses the COMMIT (install once with `git config
core.hooksPath .githooks`), and `prebuild` refuses the DEPLOY. A gate that runs
only at build time reviews bytes that were published by the push — on a public
repo the push IS the publication. Note also that its verdict is HOST-DEPENDENT:
gate 1 is patterns **plus** the by-name deny-list, and the real names live in a
gitignored file, so Vercel runs the pattern half against *fictional* names and
says so in its status line. Read the line; do not read "OK" as "the same check
passed".

**Retraction, 2026-08-11:** commit `2a7ecfc`'s subject claims it stopped the
deny-list leaking. It did not. The tokens are gone from HEAD and from all future
commits, but they are still served on older commits, exactly as the rule three
paragraphs up predicts. Removing a secret from the tip of a public repo removes
nothing. Whether to force-push + ask GitHub to purge, or accept and document, is
Karl's call — the present state is documented, not resolved.

**Unsignposted 2026-08-13.** This paragraph used to print the exact commit SHA.
That was a real disclosure written for an audience of one — but this file is
world-readable, and the launch is designed to send strangers to this repo. The
document that admits the exposure was also publishing the coordinates for it,
turning a needle-in-a-haystack into a two-command retrieval. The admission
stays; the pointer is gone. **This narrows retrieval, it does not fix
anything** — the objects are still served, and re-adding the SHA anywhere
public undoes it. Verified 2026-08-13: six real name tokens remain reachable on
ten commits that are ancestors of `main`, so a plain `git clone` still carries
them. The rotation runbook, not this edit, is what closes it.

**Trap: this file is one of the gate's sources.** `gen-flow.py` anchors excerpts
into `CLAUDE.md` itself (e.g. a `Links rail` regex at `gen-flow.py:640`), so
editing or reorganising this document can fail the gate and block every deploy —
including a docs-only commit. Run `npm run check:flow` after touching CLAUDE.md,
`loop/*.py`, `scripts/*.mjs`, `app/*`, or `data/*.json`.

Langflow is a **visualization surface only** — LangGraph is the runtime (ADR).
Langflow Desktop was retired as a dependency on 2026-08-05: the canvas is fully
regenerable from the repo via `langflow/gen-flow.py`, and the app does not need
to be running for anything.

## Working rules

- **Bias to ship.**
- **No multi-agent review swarms unless explicitly asked.**
- **Commit + push after every working increment.** Verify the DEPLOYED URL after
  every push — a clean local tree has twice hidden work that never left this Mac.
- **Never `npm audit fix` / `--force`** here: it downgrades next 16.2.11 → 9.3.3.
- **Never raise a score to flatter the work.** The launch outcome is logged as
  `dod_items_verified_on_prod=3, partial-win`, not 4, because the "every /war
  number matches git truth" clause still does not fully pass. Two numbers break
  it, and the documented one is the smaller: the commit tile structurally trails
  by one (`gen-ledger.mjs` cannot include the commit that carries it), AND the
  deploy tile reads 26 against 4 in `data/deploys.json`. The deploy number is
  TRUE against Vercel's API — the defect is durability, not honesty: it is
  assembled in an evictable build cache, so it can silently fall. It is also the
  only closable half, and it needs a `VERCEL_TOKEN` so `sync-deploys.mjs` can
  run. Raise the score only when that is genuinely closed.

## What the 2026-08-19 audit established (do not re-derive)

- **`/war` is THE hub, read-only** (Karl's ruling). Management stays CLI-on-DGX.
  This moots the Cockpit, a separate accounts app and `/admin` — do not build
  them. The constraint behind the ruling is structural: this app has **zero API
  routes** and Vercel has no Python runtime, so no screen can control the loop
  without a channel that was not authorised.
- **`/war` is build-time data wearing live clothes.** `app/war/data.ts` obtains
  everything through four static JSON imports and there is no runtime `fetch` or
  `fs` read anywhere in `app/`. `force-dynamic` only re-evaluates `Date.now()`,
  so the clock ticks and the ages grow while every number is frozen. It makes
  staleness MORE visible, not less. Any new panel obeys the same rule.
- **The loop is alive and starving.** 1140 timer ticks had produced exactly one
  pass as of 2026-08-19; the last was 2026-08-11. Idle ticks are healthy by
  design (`SuccessExitStatus=0 2 4`) — the problem is fuel, not health.
- **Hop 5 does not exist.** Nothing copies `~/ll-loop/out/loop-runs.json` into
  `data/`. The only rsync in this repo is Mac→DGX for code. This is the reason
  a pass can run unattended and still never reach the site, and it is the last
  place "autonomous" stops being true.
- **Failures are invisible to every UI.** The dead-man's switch works, but it
  writes to `~/logs/lucky-loop-failures.log` on the DGX — not the repo, not the
  vault.
- **A hand-typed number in the Langflow canvas is a lie with a green check next
  to it.** `--check-drift` compares the generated canvas to the committed one,
  so a stale hand-authored LABEL regenerates identically forever. The canvas
  announced `REPO_PUBLIC = false` and `1 pass` for two weeks that way. Node
  titles and edge labels that contain a number must be DERIVED in `gen-flow.py`
  — `_run_count()` and `_repo_public()` are the pattern.
- **Declaring `openGraph` in a child route segment stops Next inheriting the
  root segment's generated image.** `/loop` shipped `og:image=0` while `/` had
  one, and the build was green either way. Hence the one-line re-exports in
  `app/{war,loop}/opengraph-image.tsx`. If you add a route with its own
  `openGraph`, add its image re-export too, and verify by grepping
  `.next/server/app/<route>.html` — no gate covers this.
- **Only `lucky-loop-one.vercel.app` serves strangers.** `ssoProtection` is on
  (`all_except_custom_domains`), so per-deployment and `-git-main-` URLs 302 to
  a Vercel login. Never share a link copied from the Vercel dashboard.
- **Web Analytics is not enabled**, so there is no traffic baseline for any
  launch claim, before or after.

@AGENTS.md

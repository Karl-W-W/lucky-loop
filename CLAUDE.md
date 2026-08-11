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
  imagined exist (GitHub, Live site) — Vercel/Supabase/Phoenix/GBrain rows have
  never been added.

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
  number matches git truth" clause still does not fully pass (the commit tile
  structurally trails by one — `gen-ledger.mjs` cannot include the commit that
  carries it). Raise it only when that is genuinely closed.

@AGENTS.md

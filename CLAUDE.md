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

**Known gap, do not paper over it:** the loop has run exactly ONCE (2026-07-30,
attended, one document). No cron, no queue, no second item, and it has never
emitted a `source=loop` event to `~/brain` despite the architecture pin saying
each pass should. Copy on the site must not imply repetition or autonomy that
this does not support.

## Style

Keep the current dark command-center look: tokens live on `.war-root` in
`app/globals.css` (validated dataviz palette — series blue/orange, status
colors reserved for state, ink/grid/surface tokens). Charts follow the specs
already in the components: 2px lines, ≥8px markers with surface rings,
hairline solid gridlines, text in ink tokens never series colors, tables as
the no-hover fallback.

## Build

`npm prebuild` runs two things, in order:

1. `scripts/gen-ledger.mjs` — regenerates `data/ledger.json` from `git log`.
   It refuses to write on a shallow checkout or when the commit count regresses.
2. `python3 langflow/gen-flow.py --check` — the **drift gate**. `langflow/`
   holds an architecture canvas generated from this repo's own source, with each
   node carrying a regex-anchored verbatim excerpt of the file it documents. If
   a documented file or anchor disappears, `--check` exits non-zero and the
   build fails. That is deliberate: the canvas cannot silently rot.
   **If a deploy ever fails here during an incident**, the escape hatch is to
   drop the `&& python3 …` from `prebuild` and ship; then fix the anchor. Run it
   alone with `npm run check:flow`.

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

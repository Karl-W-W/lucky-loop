# Lucky Loop

**Product:** Lucky Loop is an agent harness for Claude Code with a visual War
Room, aimed at non-technical builders. This repo is both the product and the
dashboard we run the company on.

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
- **Flow panel** — diagram rendered FROM the LangGraph definition in `/loop`;
  until `/loop` exists, placeholder Perceive → Decide → Act → Evaluate → Adapt.
- **Links rail** — GitHub, Vercel, Supabase, Phoenix, Langflow, GBrain, from
  `data/links.json` (edit there, not in components).

## Style

Keep the current dark command-center look: tokens live on `.war-root` in
`app/globals.css` (validated dataviz palette — series blue/orange, status
colors reserved for state, ink/grid/surface tokens). Charts follow the specs
already in the components: 2px lines, ≥8px markers with surface rings,
hairline solid gridlines, text in ink tokens never series colors, tables as
the no-hover fallback.

## Working rules

- **Bias to ship.**
- **No multi-agent review swarms unless explicitly asked.**
- **Commit + push after every working increment.**

@AGENTS.md

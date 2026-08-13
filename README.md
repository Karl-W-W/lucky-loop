# Lucky Loop

An agent harness for the admin you'd rather not do — with a **War Room** that
is public. This repo is both the product and the dashboard we run the company
on, so what you can read here is what actually ran.

**Live:** <https://lucky-loop-one.vercel.app>

- **`/loop`** — the LangGraph agent loop, pass by pass: Perceive → Decide →
  Act → Evaluate → Adapt. Every pass the loop has made is rendered from the
  artifact it wrote — the graph definition it executed, the assertion it
  declared, and how it terminated. Not a demo: real recorded runs.
- **`/war`** — the War Room: OKR progress (`data/okrs.json`), the Growth
  Ledger (git commits + Vercel deploys), the loop flow diagram, and a links
  rail (`data/links.json`). Real data only — no mock telemetry.

The loop runs unattended on a `systemd --user` timer against a local Ollama
model, and writes its decisions and outcomes back to its operator's vault.
It does **not** run on Vercel, which has no Python runtime.

**What this does not yet prove:** the corpus is two documents, and one of them
is a synthetic fixture written to exercise the redaction gates. Generalisation
across real document types is unproven, and we would rather say so here than
let the site imply breadth it hasn't earned.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # see below — this is not just `next build`
```

`npm run build` runs a `prebuild` of three gates, in order, and a failure in
**any** of them blocks the build:

1. `scripts/gen-ledger.mjs` — regenerates `data/ledger.json` from `git log`.
2. `loop/check_artifacts.py` — the redaction gate: refuses to publish loop
   artifacts containing PII.
3. `langflow/gen-flow.py --check-drift` — the drift gate: refuses to ship a
   canvas that no longer matches the source it documents.

Gates 2 and 3 need `python3` on PATH. A fresh clone also has no commit-time
redaction gate until you run `git config core.hooksPath .githooks` once —
that setting is local and cannot be committed.

See `CLAUDE.md` for the working rules and data conventions.

# Lucky Loop

An agent harness for Claude Code with a visual **War Room**, aimed at
non-technical builders. This repo is both the product and the dashboard we
run the company on.

- **`/war`** — the War Room: OKR progress (`data/okrs.json`), the Growth
  Ledger (git commits + Vercel deploys), the Loop flow diagram, and a links
  rail (`data/links.json`). Real data only.
- **`/loop`** — (coming) the LangGraph agent loop: Perceive → Decide → Act →
  Evaluate → Adapt.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000/war
npm run build      # regenerates data/ledger.json from git log, then builds
```

See `CLAUDE.md` for the working rules and data conventions.

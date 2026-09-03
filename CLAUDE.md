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
  than a silently-dropped row. It renders as **Assets** and carries six rows
  since 2026-08-21: source, loop artifacts, the raw status snapshot, the gates,
  the roster, the canvas. Those are NOT the six this file originally imagined —
  Vercel/Supabase/Phoenix/GBrain were never built, still are not, and filling
  the rail did not build them; they keep their own GAP nodes on the canvas. The
  node title is derived by `_link_count()`, because "2 of 6 specified" was
  hand-typed and would have survived the fill under a green drift check. The
  second row used to be "Live site", pointing at the site you were already on:
  a rail whose only job is to send you elsewhere, spending half its rows on a
  loop back to itself.

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

## The loop is an ADMIN TRIAGE queue, not a general document loop (2026-08-26)

`loop/graph.py:56-57` fixes the entire vocabulary:

```python
ISSUER_KINDS = ["cloud-provider", "utility", "telecom", "tax-authority", "bank", "other"]
DOC_TYPES    = ["invoice", "vat-invoice", "reminder", "statement", "notice", "receipt", "other"]
```

`perceive()` prompts with *"You classify a document for an admin triage queue"*,
and the assertions it can be held to are `bill_has_amount`, `urgency_justified`,
`disposition_actionable`. There is **no realm concept anywhere** — not in
`run.py`, which takes a single flat `--inbox`, and not in the graph.

So a car-export lead or a farm document dropped into `loop/inbox/` is not
mis-handled by accident: it is *forced* into the billing enum, best case landing
on `other`/`other` and then judged by an assertion written for bills. **Adding a
second inbox directory would not fix this** — the enum does the classifying, not
the path. Giving these realms a real home means realm-specific enums and a
per-realm assertion set, which changes the compiled graph, `loop-def.json` and
therefore the canvas and the drift gate. That is a real piece of work, not a
directory.

Until then, non-admin documents do NOT enter the loop. Their drop targets are
`~/brain/realms/<realm>/` on the DGX, read by the nightly queue's memo jobs,
which produce a grounded summary and never touch `~/ll-loop/inbox/`. Each realm
folder carries a dot-prefixed `.README`; the queue's source gate skips dotfiles,
the same rule `pick_item()` already uses for `.done/`, so the explainer never
becomes a source. An empty realm reports "no source" and does not run — that is
the resting state, not a failure.

## Hop 0 is a GATE, not a gap — and the Hermes verdict (2026-08-25)

Filling `loop/inbox/` was counted as the last missing automation for fourteen
days. It is not missing. The loop derives an artifact from the document and
publishes it to a PUBLIC repo through gates that have already been shown
fail-open once, so **choosing the document IS the control.** Automating the
choice removes a control. Automating what sat on top of the choice removes
toil. Only the second one shipped, and the distinction is the whole finding.

`npm run feed:loop` (`scripts/feed-loop.mjs`) is the symmetric twin of
`npm run sync:loop`, guards copied rather than reinvented, and **it sends
nothing by default.** It extracts to UTF-8 (`run.py` does `read_text` and
nothing else, so a PDF otherwise "succeeds" as mojibake); names the item
`item-NNN.txt`, because `pick_item()` prints the filename to stdout whenever the
queue holds more than one item and the unit sends stdout to the journal — a
filename is a document title, the same rule `sync-loop.mjs` already applies in
the other direction; checks the host still holds `name_tokens_local.py` BEFORE
the bytes cross, rather than letting `run.py` fail-closed ten minutes later into
a journal nobody reads; refuses a name collision; and verifies the sha256 back
off the host. It reports the document's SHAPE — PII classes `redact.py` can see,
count of tokens gate 2 will deny-list — never its text, because the terminal it
prints to is often one an agent is reading. `--probe` proves the wire with a
dot-prefixed file that `pick_item()` filters by its own rule. `--yes` is a
DECLARED human step, not an enforced one; say that plainly rather than dressing
it up.

**Hermes Bot Mode: NO on the one question it was given** — can a single
Perceiver bot fill the inbox unattended. Verified first-hand against the
vendor's docs, not via a summary:

- **Bot Mode "ships built into the desktop app"**, a Bot is created by hitting
  "New Agent" in a GUI roster, and **there is no `hermes bot` command**. On a
  headless Linux box what remains is `hermes profile create` + `hermes cron
  create` — a cron job. That box already runs a cron job against that inbox
  every ten minutes.
- **Routines deliver to chat**: "Runs land in the Bot's own chat history." The
  filesystem is not a delivery target.
- **`approvals.cron_mode` defaults to `deny`** — an unattended session refuses
  dangerous shell commands and "the agent must find another path". Letting a
  Perceiver shell out unattended means turning that off on the box holding real
  mail, the vault, and a passphrase-less SSH key.
- **Nothing in Hermes fetches the documents.** Email is an INBOUND adapter that
  delivers what arrives; the one reach-in path is a Google Workspace skill over
  OAuth, whose loopback flow the docs say breaks headless, worked around with an
  `ssh -N -L` port-forward from the laptop. That is a human at a browser.
- **In Hermes' favour, against the first draft of this finding:** it DOES ship
  document extraction for PDF text layers and .docx/.xlsx/.odt/.rtf/.epub. The
  format gap is real but smaller than claimed. Scanned pages still need OCR plus
  a vision model, which a text-only local model cannot do.
- The model objection is the WEAK one and should not be leaned on: the docs list
  `llama3.2:3b` as no-tool-calling, "lightweight quick answers only", and reject
  any model under 64,000 tokens of context at startup — but the host already
  holds `qwen2.5:14b`, `llama3.3:70b` and `nemotron-3-super:120b`. The honest
  version is that a Perceiver would simply not run on the loop's model.

Hop 0 decomposes into **obtain → extract → decide-it-may-be-published →
deposit.** Hermes does *extract* well and *deposit* trivially — so does `scp`.
It cannot *obtain* without a new credential on the least-secured box, and it
must not *decide*. **Do not install Hermes to close Hop 0.** If it is ever
installed here, install it for a different job and name that job.

**The job is named, 2026-08-28. Hermes is installed, and its job is: interface
and chat runtime, never orchestration.** It is the room where Karl talks to his
agents — nothing decides there, nothing is acquired there, nothing is
orchestrated there. The hands-on verdict behind this is that the vendor
*excludes* the orchestration case by contract, not by weakness:
`tools/bot_mode_dm.py` injects the teammate tool ONLY into a human-facing Bot
Chat session and never into cron agents or subagents; `tools/bot_relay.py` gives
the Desktop every socket, so cross-machine envelopes expire as `queued_expired`
after 900 s with the laptop closed; and `approvals.cron_mode` /
`single_query_mode` both ship `"deny"`. Orchestration lives in `loop-factory`
(`delegate` → `claude -p` on Max), and that split is the signed ADR amendment of
2026-08-28.

`gbrain` is wired into Hermes as an MCP server on BOTH hosts as of 2026-08-28 —
DGX registers `~/brain/tools/gbrain-mcp.sh` directly, the Mac reaches it over
`ssh dgx-remote`. It is scoped to **76 read-only tools by allowlist**
(`mcp_servers.gbrain.tools.include`), not the 131 `hermes mcp add` enables by
default. That is not fussiness: `data/agents.json` publishes on a public website
that Scout may "never write to the vault", and the default set includes
`put_page`, `delete_page`, `forget` and `purge_deleted_pages`. An allowlist also
fails CLOSED when gbrain upgrades — a denylist would silently grant whatever new
write tool 0.47 ships. Same reasoning as every other gate here. If an agent
genuinely needs a new tool, add it to that list where a human can see it.

## The Today page and the needs-you queue (2026-09-03)

Karl's ruling: he wants to **manage the output of agents**, nothing else, on one
screen a caveman could read. That screen is the Hermes Desktop **Today** page: a
rewrite of the Fleet plugin with four blocks in reading order — NEEDS YOU (the only
block with actions, each a copy-pasteable command), WHAT THE AGENTS DID (one row per
nightly job, delegation, loop tick and cron run; expand for the text), GOALS (this
repo's `data/okrs.json`, with each key result labelled **derived** or **declared**),
THE BOX (one line; the former Fleet sections fold out as details). The same page is
served as text at `/api/plugins/fleet/today.txt` for an agent's context window.

Sources of truth, and where the code lives:

- Frontend: `hermes/desktop-plugins/fleet/plugin.js` in this repo, installed at
  `~/.hermes/desktop-plugins/fleet/plugin.js` on the Mac (hot-reloaded; write it
  atomically — a half-written file is caught by the reloader). Backend:
  `hermes/plugins/fleet/dashboard/{plugin_api.py,today_api.py,manifest.json}`,
  installed under `~/.hermes/plugins/fleet/dashboard/` on the loop host; Python
  changes need `systemctl --user restart hermes-serve` there (about 12 s; the Desktop
  reconnects). The repo copy is the versioned one; the runtime doors are installs.
- The queue is `queue/needs-you.json` in the PRIVATE vault, never in this repo. Rule
  (O4/KR2): **an item exists there before it is mentioned in chat.** Agents add
  items; only Karl closes one (`done: true` + `doneOn`). `/clockin` reads it,
  `/clockout` appends to it.
- Derived key results are computed in `today_api.py`, keyed by objective/KR id, from
  files the loop host holds: the queue, `~/ll-loop/out/loop-runs.json`, the
  retrieval-eval dashboard. Everything else renders as **declared**. A derivation that
  flatters the work is deleted, not tuned: the first latency KR read ledger pairs a
  clockout writes together and reported 100 %; it now measures the queue and reads 0.
- The page is READ-ONLY like `/war` and the Fleet page before it. Hermes stays
  interface and chat runtime; nothing on this page starts, stops, closes or sends.

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
- **Hop 5 existed nowhere until 2026-08-21.** Nothing copied
  `~/ll-loop/out/loop-runs.json` into `data/`; the only rsync in this repo was
  Mac→DGX for code. That was the reason a pass could run unattended and still
  never reach the site. **Closed by `npm run sync:loop`**
  (`scripts/sync-loop.mjs`): one command pulls the artifacts, refuses to write
  when the host returns fewer passes than are already committed (the
  `gen-ledger.mjs` guard, copied not reinvented), and **does not commit** — on a
  public repo the commit is the publication, so a human still reads the diff.
- **`data/loop-status.json` is the loop's only telemetry off the DGX.** Written
  by the same command: queue depth, scheduler last/next tick, last tick exit
  code and meaning, last failure — each sampled at `syncedAt`. It exists because
  "no new pass in `data/`" was two different facts wearing one face (the loop is
  starving, or nobody ran the sync) and nothing outside the DGX could separate
  them. **Counts only, never filenames** — a filename here is a document title.
  Anything rendering a field from it must render `syncedAt` beside it, or it has
  reintroduced the bug the file exists to kill. It is gated by
  `check_artifacts.py` and by `.githooks/pre-commit` like every other artifact.
- **Failures are still invisible to every UI**, but no longer invisible to
  every *reader*: the dead-man's switch still writes only to
  `~/logs/lucky-loop-failures.log` on the DGX, and `loop-status.json` now
  carries its last timestamp. No panel renders it yet.
- **The gates now also run server-side** (`.github/workflows/gates.yml`,
  2026-08-21). `.githooks/pre-commit` is installed by local git config and is
  not in the repo, so anything acting through the GitHub API had no
  commit-boundary gate at all. CI holds that position — but it runs the
  **pattern half only**, because `loop/name_tokens_local.py` is gitignored, and
  it says so in its step summary. Green in CI is not "the names ran".
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

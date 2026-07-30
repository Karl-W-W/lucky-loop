# Langflow at Lucky Loop

**What Langflow is for us: the map, not the engine.**

This directory generates one Langflow canvas that mirrors the entire Lucky Loop
backend — every ingest path, the five-node loop, both redaction gates, the build
scripts, every committed JSON file, the render layer, and every known gap.

Read that sentence again, because the mistake is easy and expensive: **Langflow
does not run anything at Lucky Loop.** The loop that does real work is
`loop/graph.py`, a LangGraph `StateGraph` on the local runner. Langflow is where
we *look at* the system. Pressing Play on this canvas runs a mirror of the
architecture, not the architecture.

---

## Why a generated canvas instead of a drawing

The repo already has a rule: `data/loop-def.json` is derived from the compiled
LangGraph via `get_graph()`, never hand-authored, so the diagram on `/war`
cannot drift from the code that ran. `langflow/gen-flow.py` applies that same
rule one level up.

Every node on the canvas embeds a **real source excerpt, read from the
repository at generation time**, anchored to a regex. Move the code and the
excerpt moves with it. Delete the function and generation *fails loudly* rather
than shipping a picture of something that no longer exists:

```
gen-flow: anchor '^def route_after_adapt' no longer matches in loop/graph.py.
The code moved — update the node definition, do not loosen the anchor.
```

A diagram that can silently describe code living somewhere else is exactly what
this is not.

---

## Using it (2 minutes)

```bash
# 1. Open Langflow Desktop. That's it — no login, no API key.
# 2. From the repo root:
./langflow/push-flow.sh
# 3. Langflow -> Projects -> "Lucky Loop — Architecture"
```

`push-flow.sh` regenerates the JSON and **upserts** it — repeated pushes update
the same canvas instead of littering Langflow with copies. If Langflow Desktop
isn't running it exits non-zero and changes nothing.

Prefer the GUI? `langflow/lucky-loop-architecture.json` is a plain Langflow
1.9.2 flow — import it with the upload icon next to **Projects**.

Check that the map still matches the code without touching Langflow:

```bash
./langflow/push-flow.sh --check     # non-zero if any excerpt went stale
```

---

## How to read the canvas

It flows **left to right**, one column per stage, in two bands that converge on
the data column — which is exactly what the repo does, since committed JSON is
the only thing the two halves share.

```
loop band   inbox → run.py → idempotency → build() → Perceive → Decide → Act
            → Evaluate → Adapt → route → Gate 1 → Gate 2 → exit → data
web band                        git log / Vercel → build scripts → data
                                                        data → accessors → pages
```

The one edge that runs **backwards** — `route_after_adapt → Decide` — is the
point of the whole product. That is the retry. It is what makes this a loop and
not a pipeline.

### The status vocabulary

We reuse Langflow's own badges, so nothing needs a legend:

| Node | Meaning |
|---|---|
| plain (purple) | Ships today and is exercised by a real pass |
| **Beta** badge | Exists, but has never been proven end to end |
| **Legacy** badge | A **gap** — specified or documented, but not implemented |

Dashed edges mark relationships that are missing, unproven, or contested.

**Double-click any node → the code panel shows the real excerpt it mirrors**,
with its `SOURCE:` line naming the exact file and symbol. That is the fastest
way to get a new teammate from "what is this box" to the actual code.

---

## What the map is telling us today

40 nodes: 29 shipping, 2 unverified, **9 gaps**. The gaps are the point — this
is a launch-eve honesty instrument, not a marketing diagram. In rough order of
how much they'd hurt:

1. **Generalisation is unproven.** n = 1. One pass, one item, one document type.
   The idempotency key means that item can never run again, so a second data
   point needs a genuinely new document — and nothing has fed one in.
2. **Nothing schedules the loop.** rsync → ssh → run → rsync back → git commit.
   Five manual steps, no cron, no CI, no webhook, and nothing triggers a rebuild
   afterwards. The "autonomous" claim stops at the machine boundary.
3. **The KR2 rubric is never rendered.** `data/okrs.json` carries five
   pre-committed criteria and `app/war/data.ts` claims they are "rendered on
   /war so the bar is public" — `OkrPanel` never reads `kr.rubric`. Our only
   100% KR ships as a self-awarded number with its certifying bar invisible.
4. **Vault events are never written.** `docs/diagrams/target.mmd` draws Adapt
   emitting decision + outcome events to the vault, and `loop/README.md` calls
   that event evidence of a run. No code writes it.
5. **`REPO_PUBLIC` ruling is contested.** The comment in `app/war/data.ts`
   records a Jul 28 ruling that the repo goes public at launch; the vault
   records a Jul 30 ruling that it stays private. The flag is correct either
   way today; the launch-day *step* is not. Reconcile before Jul 31.
6. **No observability.** Phoenix is in the links-rail spec and wired nowhere.
   The LangGraph run emits no traces, so a pass that fails before the write
   leaves no record at all.
7. **Model failure degrades silently.** `ask()` returns `{}` on a decode error
   and `_pick()` coerces to `other`/`none`/`file`. A dead model still yields a
   valid-looking, converged artifact.
8. **`data/links.json` is 2 of 6.** Vercel, Supabase, Phoenix, Langflow and
   GBrain rows were never added; the rail silently renders short.
9. **Product framing vs shipped runtime.** We describe Lucky Loop as an agent
   harness *for Claude Code*; the shipped loop is LangGraph + local Ollama. Same
   five-node shape, different runtime.

Plus two **Beta** nodes: `sync-deploys.mjs` has never made a live HTTP call, and
the `REPO_PUBLIC` contradiction above.

---

## Where Langflow does and does not belong

**Use it for:**

- Onboarding. One canvas beats a directory tour, and the code is one
  double-click away.
- Architecture review. Gaps are visible as red Legacy cards next to the thing
  they break, not buried in a backlog.
- Talking to non-technical people about what we actually built — which is the
  whole premise of the product.
- Prototyping a *future* node before committing to it in `loop/graph.py`.

**Do not use it for:**

- Running the loop. The loop is `loop/graph.py` on the runner. Langflow has no
  role in a production pass.
- Anything touching a real inbox item. Raw documents never leave
  `loop/inbox/` (gitignored) and never enter Langflow.
- Storing credentials. Nothing here reads a secret. Langflow Desktop's backend
  is loopback-only with auto-login, and the loop reaches Ollama over plain HTTP
  on `127.0.0.1` — deliberately outside the credential surface.

**The rule for the team:** if you change the backend, run
`./langflow/push-flow.sh` in the same change. The map is generated, so keeping
it true costs one command. Letting it rot costs the trust that made it useful.

---

## Files

| file | role |
|---|---|
| `gen-flow.py` | the generator — node/edge definitions, excerpt anchors, Langflow 1.9.2 wire format |
| `push-flow.sh` | regenerate + upsert into the running Langflow Desktop; `--check` verifies excerpts |
| `lucky-loop-architecture.json` | the generated flow, committed so it can be imported without running anything |

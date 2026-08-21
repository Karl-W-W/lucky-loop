# loop — the product half

`/war` is the dashboard we run the company on. This is the thing it watches.

One real item from Karl's admin pile goes in; a triage verdict comes out; the
pass is published on `/loop`. Perceive → Decide → Act → Evaluate → Adapt, on a
real LangGraph `StateGraph`, with a conditional edge that sends the loop back to
Decide when the pass fails its own declared assertion.

## Where it runs

**Not on Vercel.** The site is a static build with no server runtime and no
Python; adding a backend to it to host this would be an architecture violation,
not a fix. The loop runs on the DGX Spark, where LangGraph and Ollama are already
installed, and the site renders the artifacts it commits — the same pattern the
Growth Ledger already uses.

The model is a local Ollama model over plain HTTP on loopback. There is no API
key anywhere in this directory, which is deliberate: the loop stays outside the
credential surface entirely.

Since 2026-08-11 a `systemd --user` timer (`deploy/lucky-loop.*`, `Linger=yes`)
runs the pass unattended on the schedule in the unit file. You do not run it by
hand any more, and you should not: a manual run competes with the timer for the
same queue.

**Pushing code out** — after editing anything in `loop/`:

```
rsync -az --exclude=inbox --exclude=__pycache__ loop/ dgx-remote:ll-loop/
```

**Pulling artifacts back** — this is hop 5, and until 2026-08-21 nothing
automated it. A pass could run unattended, write its artifact, and still never
reach the site, because the only thing that crossed that gap was a human
remembering an rsync:

```
npm run sync:loop            # pull, guard, write data/ — the COMMIT stays yours
npm run sync:loop -- --check # report what is on the host, write nothing
```

It refuses to write when the host returns fewer passes than are already
committed — published history does not shrink on the word of one ssh — and it
never commits, because on a public repo the commit is the publication and a
human reads the diff first.

It also writes `data/loop-status.json`: queue depth, the scheduler's last and
next tick, and the last tick's exit code, each sampled at `syncedAt`. That file
exists because "no new pass in `data/`" was two different facts wearing one
face — the loop is starving, or nobody ran the sync — and nothing outside the
DGX could tell them apart. Counts only, never filenames: a filename here is a
document title, and a document title is the leak.

## The input path

`loop/inbox/` is **gitignored**. One exported mail or bill item goes there and
never reaches git. The loop reads a file; it holds no inbox credentials and
opens no mailbox.

## Why you cannot read the document on the website

Two gates run before any artifact is written, and the writer refuses to emit
anything at all if either one fires:

1. **`verify_clean`** — pattern gate. Emails, IBANs, card and phone shapes,
   currency amounts, reference codes, long digit runs, known personal names.
2. **`verify_no_source_tokens`** — provenance gate. Every capitalised token in
   the source document becomes a deny-list entry, minus this loop's own
   vocabulary. Names are unenumerable, so rather than guessing which words are
   sensitive, anything lifted verbatim from the item is refused.

Gate 2 is what keeps the *sender* out of the artifact, which gate 1 cannot do
without an exhaustive vendor list. It is also why the committed record says
`cloud-provider` and `50-500` instead of a company and a number.

Structurally, the artifact carries typed enum values plus one bounded,
twice-gated rationale line. `humanSummary` is composed **in code** from the
typed fields — a summary the model writes is a summary that can name the sender.

`python3 loop/test_redaction.py` tries to defeat both gates with seven leak
classes and asserts the committed artifact is clean. A redaction step nobody has
attacked is a promise, and DoD #2 and #4 fail on promises.

## Exit contract

| code | meaning |
|---|---|
| `0` | `terminationReason == "converged"` — and nothing else earns a zero |
| `2` | idempotent success: this exact item+graph+model already has a pass; no second record |
| `3` | hard fail: error, redaction violation, or **cap exhaustion** |

Exhausting the iteration cap is a stop, not a win. `max_iterations` never reads
as success — not in the exit code, not on `/loop`.

Evidence that a run happened is the committed artifact and the vault event,
never this process's stdout or exit code.

## The definition is the code

`data/loop-def.json` is derived from the compiled graph via `get_graph()` on
every run — never hand-authored. `/war`'s Flow panel and `/loop` both render it,
so adding a node in `graph.py` updates both with nobody editing a diagram. A
drawing that describes code living somewhere else is exactly what this is not.

## Files

| file | role |
|---|---|
| `graph.py` | the `StateGraph`, the five nodes, the declarable assertions, the vocabulary |
| `redact.py` | both gates + amount bucketing |
| `run.py` | idempotency key, exit contract, artifact emission |
| `test_redaction.py` | adversarial proof the gates hold |

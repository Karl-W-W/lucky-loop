# Handoff — Command Center, slice 1 (built 2026-09-23 → 2026-09-27)

Written for the next session. **Every claim here is a hypothesis** — each carries the one
line that re-checks it.

Sources (private vault, vault-relative): the council record
`captures/council/council-command-center-2026-09-22.md` (CHAIR section) and the exemplar
session write-up `captures/2026-09-23-exemplar-command-center-session.md`. Running log:
`captures/council/cc-2026-09-23-slice1-log.md`.

## SHIPPED (with numbers)

- **The Live Session in the Today plugin** (`hermes/desktop-plugins/fleet/plugin.js`):
  NeedsYou grouped by agent with `ask_kind · ask`, one copyable `decide <id> <word>` line
  per option, a parked list; a parked-aware "N need you" in the status bar and the palette
  (feature-detected); an error boundary on every route; a new `/live` page (failed-agent
  band, agent tiles, the call in batches of five, receipts, parked). It writes nothing.
  Check: `cmp hermes/desktop-plugins/fleet/plugin.js ~/.hermes/desktop-plugins/fleet/plugin.js` → silent.
  Check: `grep -c "h(Section, { title:" hermes/desktop-plugins/fleet/plugin.js` → 8.
- **Acceptance by a separate verifier**: steps 0, 1, 2, 3, 7 PASS; 6 PASS on base
  `origin/main`; 4, 5, 8 not runnable without Karl's own answers or a rollback.
  Check: `git diff origin/main -- .claude hermes | grep '^+' | grep -ciE 'mbg|/home/cube|brain\.git'` → 0.
- **`/clockout` 1b** now requires the three Live Session fields on every new card, the
  tier-3 no-op-first rule, and the vault writer for any change to an existing card.
  Check: `grep -c 'ask_kind' .claude/commands/clockout.md` → ≥1.
- **Gates on this branch**: redaction OK, redaction tests PASSED, drift none (41 nodes),
  eslint 0 errors. Check: `python3 langflow/gen-flow.py --check-drift | tail -1`.
- **The Stripe-minimum legal pages** gained the phone number (on the `site/stripe-minimum`
  branch). They are NOT live — see OPEN DECISIONS.
  Check: `curl -s -o /dev/null -w '%{http_code}\n' https://lucky-loop-one.vercel.app/impressum` → 404 until the merge.

## PRINCIPLES

1. **Render before you commit a refactor.** A lint-driven change to the shared sampler
   made the status-bar chip miss the first sample ("needs you …" instead of the count);
   only the headless render caught it. Fixed with `useSyncExternalStore`.
2. **The count is parked-aware and says so.** The plugin shows one fewer than the server
   because the server counts a parked card; the difference is named, not hidden.
3. **A refusal is a stop, not a route** (rule 10). The PR merge and a writer extension were
   both refused this session; neither was re-attempted another way.

## OPEN DECISIONS

- **Merge PR #5** (the legal pages). Green 3/3 on its head; the merge was refused to the
  agent twice. Paste: `gh pr merge 5 --merge --match-head-commit dc4374cb1cc1ac1cc561c78bee6b5f9353941a49`.
  Check: `curl -s -o /dev/null -w '%{http_code}\n' https://lucky-loop-one.vercel.app/agb` → 200.
- **Let the vault writer file new cards** (an `add` op). Without it, no agent can file a
  card through the one writer, so two new tier-3 cards (a lawyer hour, a box-hardening
  session) are waiting outside the queue.
- **Merge `cc/slice1`** into main (this handoff and the plugin); the merge is Karl's.

## IN FLIGHT

Nothing started by this session is running. The plugin is installed and hot-reloaded.

```
cmp hermes/desktop-plugins/fleet/plugin.js ~/.hermes/desktop-plugins/fleet/plugin.js && echo same
```
Expected `same`. Anything else means the installed copy drifted from the repo.

## DATED PREDICTIONS

- By 2026-10-04, if PR #5 is merged, `/impressum`, `/agb`, `/datenschutz` and `/kontakt`
  answer 200 on the production URL. Falsified by any 404 after the merge's deploy.

## SHORTLIST

1. Karl merges PR #5 (outsider-visible).
2. Writer `add` op, then file the two waiting cards.
3. Receipts that show the word and who answered — needs a server change, which restarts
   the Today server.
Hard constraint: slice 2 does not start until PR #5 is live and 10 pilot offers are sent.

## CORPSES

- **"The step-6 diff base is the Stripe-minimum commit."** It is not an ancestor of this
  branch; its hits came from an older handoff already on public main. The right base is
  `origin/main`.
- **"The chip works"** — true before a lint refactor, false after, true again after the
  fix. Caught only because the render ran again.
- **"The writer can file a card."** It refuses unknown ids by design; filing needs a new op.
- **The acceptance test's secret regex** matches inside ids beginning `task-`
  (`ta` + `sk-…`): six false positives, traced by the verifier. Tighten it before trusting
  a zero from it.

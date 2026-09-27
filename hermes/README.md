# hermes/ — the Desktop plugin, versioned

The Hermes Desktop **Today** page and its backend. The runtime copies live in
`~/.hermes/` on each machine and are not git repos; this directory is the versioned
source of truth. Install by copying:

| File here | Installed at | Reload |
|---|---|---|
| `desktop-plugins/fleet/plugin.js` — two sidebar rows: **Today** (`/today`) and **Fleet** (`/fleet`, unchanged) | Mac `~/.hermes/desktop-plugins/fleet/plugin.js` | hot (fs-watched); write atomically; a route already on screen remounts only after navigating away or restarting the app |
| `plugins/fleet/dashboard/plugin_api.py` | loop host `~/.hermes/plugins/fleet/dashboard/plugin_api.py` | `systemctl --user restart hermes-serve` |
| `plugins/fleet/dashboard/today_api.py` | loop host, same directory | same |
| `plugins/fleet/dashboard/answer_api.py` — verb (a), `POST /answer`, **off** by default | loop host, same directory | same |
| `plugins/fleet/dashboard/manifest.json` | loop host, same directory | same |

Read-only by design, except `answer`: the page reports, it does not control. See
CLAUDE.md, "The Today page and the needs-you queue".

`today_api.py` also serves the `live` block (in `/today`, and alone at `/live`) and
`/live.txt`: the open cards in the queue's order cut in fives, each owner's state from
the herdr snapshot, the cards closed today with their word and who gave it, and the
session number (answered today ÷ (answered today + open)).

## Verb (a) — answer on the page (ships OFF)

Karl's own word on ONE open card, from `/live`: one card per click, a tier-3 word only
after a second click that shows the title and the word, only that card's own option
words or `later`, handed to the vault's existing writer (`tools/needs-you-write`, the one
`decide` uses) with `doneBy: "karl — page <word>"`. Every call, refusals included, is
logged on the loop host at `~/.local/state/lucky-loop/page-answer/log.jsonl`.

It is on only when BOTH switches are on:

1. **Server** (loop host): `echo on > ~/.config/lucky-loop/fleet-answer-verb`. Read on
   every request, no restart. Off again: `rm ~/.config/lucky-loop/fleet-answer-verb`.
   While off, `POST /answer` answers 404 and `/live` carries no offers.
2. **Page** (Mac): set `const ANSWER_ON_PAGE = true` in `plugin.js` and install it
   atomically. While false, no send button is drawn.

Selftests: `python3 plugins/fleet/dashboard/answer_api.py --selftest` (no FastAPI needed)
and `uv run --with fastapi python plugins/fleet/dashboard/today_api.py --selftest`.

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
| `../scripts/herdr-live.py` — the feed for **Agents** (`/agents`) | Mac `~/.local/share/lucky-loop/herdr-live/herdr-live.py`, run by `../deploy/com.kww.herdr-live.plist` in `~/Library/LaunchAgents` | `launchctl kickstart -k gui/$(id -u)/com.kww.herdr-live` |

Read-only by design, except `answer`: the page reports, it does not control. See
CLAUDE.md, "The Today page and the needs-you queue".

## Agents (`/agents`) — every herdr agent, live (mission v8 B3, 2026-10-02)

`herdr-live.py` subscribes to herdr's own socket events on the Mac and keeps one
Mac-local file, `~/.local/state/lucky-loop/herdr-live.json` (schema `herdr-live/1`),
current: a state change lands in the file about 0.1 s after herdr announces it, a 5 s
heartbeat re-samples anyway, and the box's herdr is read every 15 s over ssh. The
page follows that file through the Desktop's own file watcher, plus a 5 s re-read, and
flags it STALE past 20 s. The file carries terminal titles, so it never leaves the Mac:
the box still gets only the 60 s shape snapshot (`scripts/herdr-snapshot.sh`, unchanged)
behind Today's "Agents now". `useHerdrLive()` in `plugin.js` and the file's row shape
are what the WhatsApp-like agent list reuses. Check: `python3 scripts/herdr-live.py --check`.

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

**Keep it OFF until a channel exists that only the page holds.** Any process on the
loop host can read the dashboard session token, fetch an offer and post it; the Origin
check below does not stop that (the header is the sender's claim, and the Desktop's own
REST calls leave its main process with no Origin at all). The log records what arrived,
with the Origin and User-Agent it claimed; it cannot tell Karl's click from a script's.

It is on only when ALL of these are on:

1. **Server** (loop host): `echo on > ~/.config/lucky-loop/fleet-answer-verb`. Read on
   every request, no restart. Off again: `rm ~/.config/lucky-loop/fleet-answer-verb`.
   While off, `POST /answer` answers 404 and `/live` carries no offers.
2. **Origin** (loop host): the page's Origin, one per line, in
   `~/.config/lucky-loop/fleet-answer-origins`. Absent or empty: every request is refused
   403 and logged, and doneBy `karl — page <word>` is never written.
3. **Page** (Mac): set `const ANSWER_ON_PAGE = true` in `plugin.js` and install it
   atomically. While false, no send button is drawn.

Selftests: `python3 plugins/fleet/dashboard/answer_api.py --selftest` (no FastAPI needed)
and `uv run --with fastapi python plugins/fleet/dashboard/today_api.py --selftest`.

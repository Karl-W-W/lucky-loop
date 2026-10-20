# voice/ — the Call (V1, Mac-local)

Karl presses one button and talks to the fleet. The voice agent ("Commander", on ElevenAgents,
Eleven v4 Turbo) is the talker; the work stays with the Claude Code panes, reached through
client tools that run on this Mac. No tunnel, no box: V1 works with the DGX down.

```
browser page (voice/page)  ──websocket, signed URL──>  ElevenAgents (ASR · LLM · v4 Turbo TTS)
      │ client tools (fetch, per-boot token)
      ▼
bridge on 127.0.0.1:4711 (voice/bridge)  ──> herdr (fleet, tell, ask) · needs-you-write (cards)
      │                                       · data/okrs.json · ssh dgx-remote (box_health)
      └─ Keychain: the ElevenLabs key, read into memory only
```

## Karl's part
1. `voice/bin/set-key` — one hidden paste of the ElevenLabs API key into the Keychain.
2. Allow the microphone (browser) and Keychain access (first call), once.
3. Type `call` (or open http://127.0.0.1:4711/) and press Call, or the space bar.

## Agent's part
- `npm run agent:deploy` — create or update the agent from `agent/commander.json` + `agent/prompt.md`.
  The agent id lives in `~/.local/state/lucky-loop/voice/agent.json`, not here.
- `npm run measure` — time 2–3 LLMs over 10 typed turns each (5 must call the right tool),
  log the numbers to the state folder, and switch the agent to the fastest that called every tool.
- `npm test` — unit tests for the metrics, the redaction and the word mapping.
- `bin/check-key` — check C7: the key in 0 files of the repos (and their history), the vault,
  logs, shell history and process args; the bridge listens on 127.0.0.1 only.
- `bin/replay-answers` — put card answers spoken while the box was down into the queue.

## What never lands in git
The key, the agent id, transcripts, call records, timings and spooled answers all live in
`~/.local/state/lucky-loop/voice/` (mode 700). This repo is public.

## Card answers
`card_answer` maps the spoken word onto the card's own options ("approve" → the single
non-hold option) and writes through `~/brain/tools/needs-you-write` with
`doneBy: "karl by voice, source=voice, call … : "<excerpt>""`. Tier 3 cards, and anything public,
spending, secret, deleting or sending, need a spoken "confirm" after a one-sentence echo; the
bridge refuses without it. The hub is the box: while it is down, the answer is spooled locally,
the commander is told, and `bin/replay-answers` delivers it later.

## Hang-up
The page posts the transcript; the bridge writes one record (decisions, actions, C1/C2 timings,
transcript) to the call's private folder and tells the commander, the one vault writer, to file it.

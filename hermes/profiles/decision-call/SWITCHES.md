# The decision call, and the two switches (slice 3)

Karl, 2026-09-27: *"leave all essential decisions to me once the Hermes desktop app can display
the decision cards and make a call with me to discuss their effects."* This page is the one place
that says what is built, what is on, and how each of the two remaining switches is flipped.

## ON — the decision call

| part | where | source |
|---|---|---|
| `/call` view (sidebar row **Call**, ⌘K "Open the call") | Hermes Desktop, the Fleet plugin | `hermes/desktop-plugins/fleet/plugin.js`, the CALL section |
| `decision-call` profile: SOUL, config | the BOX's Hermes: the Desktop's backend is the box (127.0.0.1:9119 is a tunnel to its hermes-serve) | `hermes/profiles/decision-call/{SOUL.md,install.sh}` |
| three tools + the turn hook | `~/.hermes/profiles/decision-call/plugins/decision-call/` | `hermes/plugins/decision-call/` |

`/call` shows one open card at a time in the queue's order (the server's `live` order), with its
ask, why, what it takes, what silence does, and its words. **Start the call** opens a
`decision-call` chat primed with `call <id>`. The page writes nothing.

In the chat the agent presents the card and its effects, answers from the card and the read-only
gbrain tools, and takes Karl's word. What is enforced in code, not in the prompt
(`hermes/plugins/decision-call/__init__.py`):

- it records only through `call_record`, and only after `call_readback` of that exact card and
  word **in an earlier turn**, when Karl's newest message (read from the session store, never
  from the model) **names that word itself** ("pasted", "yes pasted") and none of the card's
  other words. A bare "yes", "sure", "ok", "no, not pasted" and "wait" all refuse. A bare yes
  could confirm a word the model was steered into reading back, and card text is written by agents;
- tier 3 asks him to name the word again, in a later turn, before anything is written;
- one confirmation records one word on one card; the readback expires after 10 minutes;
- the write goes through `~/brain/tools/needs-you-write` (the writer `decide` uses), with
  `doneBy: "karl — call <word>"`;
- on EVERY platform the vendor lists (22 on the box's build: cli, api_server, cron, whatsapp and the
  rest), the profile resolves to `decision_call` plus the gbrain read-only allowlist and nothing
  else. The allowlist is copied from the main config at install, minus `think`, which can write
  takes and spend model calls. There is no terminal, file, browser, code, web, memory or messaging
  tool. `install.sh --check` resolves each platform with the vendor's own resolver and fails on
  anything more. In the Desktop, the app adds its GUI affordances to a chat (`desktop_ui`,
  `project`), and none of them runs a shell or sends.

Voice: in the chat, the composer's voice button or **Ctrl+B** starts a spoken conversation.
The profile hears with local Whisper (on the box) and spends nothing. The Desktop's other voice
engine, `gpt-live`, bills per minute, and this profile does not use it.

**The TTS trade-off.** The vendor supports three on-device engines (piper, kittentts, neutts).
None is installed on the box or the Mac today, so the profile speaks with **Edge TTS**. Edge TTS
sends every spoken sentence to Microsoft's service, and that includes the card's text, which can
be private. Typing the call instead of speaking it sends nothing out. To make the voice local,
install one engine into the box's Hermes venv, for example `~/.hermes/hermes-agent/venv/bin/pip
install piper-tts`, then re-run `install.sh --box`. The generator picks up the local engine by
itself. That is an install into the vendor's venv, so it is Karl's call.

Install or refresh where the Desktop can open it: `hermes/profiles/decision-call/install.sh --box`
(from the Mac; it copies the sources and installs on the box). Without `--box` it installs on the
machine it runs on, which serves `hermes -p decision-call chat` in that machine's terminal only. The
installer backs up first. `--check` reports what is installed. If the profile is missing from the
Desktop's backend, **Start the call** opens nothing and says so.

## OFF — switch 1: the shim (Claude Code panes as room members)

Not before **2026-10-01**. This is Karl's rule 5 slot and the board row
`shim-claude-code-agents-in-hermes-rooms`. The code is in `hermes/shim/`. `cc-shim.py` is a
localhost OpenAI-compatible endpoint that answers a room message by running
`claude -p --resume <session> --permission-mode plan` on one seat named in `seats.json`.
`bypassPermissions` is refused.

Staged on the Mac with `hermes/shim/shim-switch.sh stage`: the script is copied and the flag says
`off`. The LaunchAgent sits in the staging directory, not in `~/Library/LaunchAgents`, so nothing
loads at login. The shim refuses to start before 10-01, and also while the flag is off or when no
private token exists.

**Flip (on or after 10-01):**

```
hermes/shim/shim-switch.sh flip <seat> <claude-session-id>
```

Then, in Hermes Desktop: Bot Mode → New Agent from profile `cc-<seat>` → add it to a room.

**Off:**

```
hermes/shim/shim-switch.sh off
```

Still Karl's before it counts as done: the ADR under rule 5, and the three amendments the row
names (the 08-28 rule, AGENT-OS Hands, rule 5). Each goes through his gate.

## OFF — switch 2: WhatsApp answers

The 09-10 ruling ("no WhatsApp") stands until Karl gives his word. Pairing needs his phone.

**Where it sits, and why.** The profile `decision-whatsapp` is staged on the box by
`whatsapp-switch.sh push`, run from the Mac. It sits in
`~/.local/share/lucky-loop/decision-whatsapp-staged`, **outside** `~/.hermes/profiles`, so nothing
serves it. The box's gateway serves every named profile under `profiles/`, and it has no key to
leave one out. It also re-reads each served profile's `.env` about every 30 seconds. While the
staged profile sat under `profiles/`, the main gateway served it. At that point, setting
`WHATSAPP_ENABLED=true` by hand would have started WhatsApp inside the main gateway.

The profile was moved out on 2026-09-27, with a backup taken first. The gateway logged
`[MULTIPLEX] Profile 'decision-whatsapp' deleted — 0 adapter(s) stopped and unrouted`, and
`gateway_state.json` lists it in `served_profiles` no longer.

What the staged profile holds:

- WhatsApp **disabled**;
- `WHATSAPP_MODE=bot`: a separate number;
- `dm_policy allowlist`, with the allowlist empty until the flip, and groups disabled;
- the same three tools as the call on every platform, and nothing else;
- `doneBy: "karl — whatsapp <word>"`.

There is no separate systemd unit, because a second gateway would serve the number twice.

It writes through the same writer as verb (a), not through verb (a)'s route. That route takes
only the Mac-only page key, and putting the key on the box would undo the page's channel.

**Flip.** This is the ONE step that turns WhatsApp on, and nothing else does. On the box, in a
terminal:

```
bash ~/.local/share/lucky-loop/decision-call-src/whatsapp-switch.sh flip
```

It does four things, in order:

1. It asks for Karl's own number as hidden input. The number is kept only in the profile's `.env`
   on the box.
2. It moves the profile into `profiles/`. The gateway then serves it, still with 0 adapters.
3. It runs the pairing. Scan the QR with the separate number's phone.
4. Only then does it set `WHATSAPP_ENABLED=true`. The gateway starts the adapter within about 30
   seconds.

**Off:** this sets the switch false and moves the profile back out of `profiles/`:

```
bash ~/.local/share/lucky-loop/decision-call-src/whatsapp-switch.sh off
```

Add `--forget` to remove the number.

**Status of either switch:** `shim-switch.sh status` · `whatsapp-switch.sh status`.

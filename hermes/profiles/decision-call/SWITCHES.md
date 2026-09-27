# The decision call, and the two switches (slice 3)

Karl, 2026-09-27: *"leave all essential decisions to me once the Hermes desktop app can display
the decision cards and make a call with me to discuss their effects."* This page is the one place
that says what is built, what is on, and how each of the two remaining switches is flipped.

## ON — the decision call

| part | where | source |
|---|---|---|
| `/call` view (sidebar row **Call**, ⌘K "Open the call") | Hermes Desktop, the Fleet plugin | `hermes/desktop-plugins/fleet/plugin.js`, the CALL section |
| `decision-call` profile: SOUL, config | the Mac's Hermes (the Desktop's local runtime) | `hermes/profiles/decision-call/{SOUL.md,install.sh}` |
| three tools + the turn hook | `~/.hermes/profiles/decision-call/plugins/decision-call/` | `hermes/plugins/decision-call/` |

`/call` shows one open card at a time in the queue's order (the server's `live` order), with its
ask, why, what it takes, what silence does, and its words. **Start the call** opens a
`decision-call` chat primed with `call <id>`. The page writes nothing.

In the chat the agent presents the card and its effects, answers from the card and the read-only
gbrain tools, and takes Karl's word. What is enforced in code, not in the prompt
(`hermes/plugins/decision-call/__init__.py`):

- it records only through `call_record`, and only after `call_readback` of that exact card and
  word **in an earlier turn**, when Karl's newest message (read from the session store, never
  from the model) is an explicit yes. "sure", "ok", "yes but…", "wait" all refuse;
- tier 3 takes a second yes in a later turn before anything is written;
- one yes records one word on one card; the readback expires after 10 minutes;
- the write goes through `~/brain/tools/needs-you-write` (the writer `decide` uses), with
  `doneBy: "karl — call <word>"`;
- the profile's only toolset is `decision_call` plus the gbrain read-only allowlist (copied from
  the main config at install). There is no terminal, file, web, memory or messaging tool.

Voice: in the chat, the composer's voice button or **Ctrl+B** starts a spoken conversation.
The profile hears with local Whisper and speaks with Edge TTS, so a call spends nothing. The
Desktop's other voice engine, `gpt-live`, bills per minute, and this profile does not use it.

Install or refresh on the Mac: `hermes/profiles/decision-call/install.sh`. The installer backs up
first. `--check` reports what is installed.

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

The 09-10 ruling ("no WhatsApp") stands until Karl gives his word. Pairing needs his phone. The
profile `decision-whatsapp` is staged on the box by `whatsapp-switch.sh push` (run from the Mac)
with WhatsApp **disabled**:

- `WHATSAPP_MODE=bot`: a separate number;
- `dm_policy allowlist`, with the allowlist empty until the flip, and groups disabled;
- the same three tools as the call, and nothing else (no terminal);
- `doneBy: "karl — whatsapp <word>"`;
- the systemd unit `hermes-decision-whatsapp.service` is written but not enabled.

It writes through the same writer as verb (a), not through verb (a)'s route. That route takes
only the Mac-only page key, and putting the key on the box would undo the page's channel.

**Flip:** on the box, in a terminal:

```
bash ~/.local/share/lucky-loop/decision-call-src/whatsapp-switch.sh flip
```

It asks for Karl's own number as hidden input, and the number is kept only in the profile's
`.env` on the box. Then:

1. `hermes -p decision-whatsapp whatsapp`, and scan the QR with the separate number's phone;
2. `systemctl --user enable --now hermes-decision-whatsapp.service`.

**Off:**

```
bash ~/.local/share/lucky-loop/decision-call-src/whatsapp-switch.sh off
```

Add `--forget` to remove the number.

**Status of either switch:** `shim-switch.sh status` · `whatsapp-switch.sh status`.

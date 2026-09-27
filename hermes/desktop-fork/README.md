# Hermes Desktop: our fork, for Command Center direction C

Direction C draws its Fleet and Rooms lists inside Hermes's own Bots tab. A runtime plugin cannot put
anything there, so the Desktop is patched. `c-parity.patch` is the whole change, against Hermes Agent
(MIT, Nous Research) commit `948e9706618220839a20c33c2fc5c19de074d835`. That is the commit Desktop
0.17.3 was built from; it is **not** upstream HEAD.

| Change | Why |
|---|---|
| `BOTS_PANE_AREA` (`'botsPane.after'`) and a `Slot` export in the SDK | The Fleet plugin renders C's Fleet and Rooms sections under the bot roster. The roster gives up height first, so the sections stay on screen. |
| Geist and Geist Mono (SIL OFL 1.1, licence file included) | These are C's typefaces. Only pages that ask for them use them. |
| A window event, `hermes:lucky-open` `{profile}` or `{group}` | The stage's composer opens a Bot's own chat, or an existing room, the same way a roster click does. An unknown room is ignored. |
| `window.__luckyBotColors` | Each bot's roster colour, so the stage paints the same bot in the same colour. The plugin validates the value before it uses it as a fill. |

On a stock Desktop, the plugin feature-detects all of this and skips it.

## Build and install (Mac)

```sh
git -C ~/.hermes/hermes-agent worktree add -b lucky/c-parity ~/Projects/hermes-desktop-c 948e9706618220839a20c33c2fc5c19de074d835
git -C ~/Projects/hermes-desktop-c apply --binary ~/Projects/lucky-loop/hermes/desktop-fork/c-parity.patch
cd ~/Projects/hermes-desktop-c && PATH=~/.hermes/node/bin:$PATH npm ci
cd apps/desktop && PATH=~/.hermes/node/bin:$PATH npm run pack
```

To install, quit Hermes. Then `ditto` `release/mac-arm64/Hermes.app` over **both**
`~/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app`, which is the one that runs, and
`~/Applications/Hermes.app`.

**Rollback:** the pre-fork apps are in `~/Archive/hermes-app-backups/2026-09-28-pre-c-parity/`. Ditto
them back.

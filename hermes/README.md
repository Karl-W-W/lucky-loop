# hermes/ — the Desktop plugin, versioned

The Hermes Desktop **Today** page and its backend. The runtime copies live in
`~/.hermes/` on each machine and are not git repos; this directory is the versioned
source of truth. Install by copying:

| File here | Installed at | Reload |
|---|---|---|
| `desktop-plugins/fleet/plugin.js` | Mac `~/.hermes/desktop-plugins/fleet/plugin.js` | hot (fs-watched); write atomically |
| `plugins/fleet/dashboard/plugin_api.py` | loop host `~/.hermes/plugins/fleet/dashboard/plugin_api.py` | `systemctl --user restart hermes-serve` |
| `plugins/fleet/dashboard/today_api.py` | loop host, same directory | same |
| `plugins/fleet/dashboard/manifest.json` | loop host, same directory | same |

Read-only by design: the page reports, it does not control. See CLAUDE.md, "The
Today page and the needs-you queue".

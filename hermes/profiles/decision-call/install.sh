#!/usr/bin/env bash
# Install the decision-call profile into the Hermes on THIS machine (both the Mac and the box hold
# ~/brain and its writer `needs-you-write`). For the Desktop, install it on the BOX: see --box below.
#
#   hermes/profiles/decision-call/install.sh            install / refresh (backs up first)
#   hermes/profiles/decision-call/install.sh --check    show what is installed; change nothing
#   hermes/profiles/decision-call/install.sh --box      install on the box, whose backend the Desktop uses
#
# What it writes, all under ~/.hermes/profiles/decision-call/ (the profile's own home):
#   plugins/decision-call/   the three tools + the turn hook (from hermes/plugins/decision-call)
#   SOUL.md                  the call's instructions (from this directory)
#   config.yaml              generated: this machine's model block and its gbrain READ-ONLY
#                            allowlist are COPIED from ~/.hermes/config.yaml at install time, so
#                            no host path or private name lives in the repo. Toolsets: the
#                            plugin's `decision_call` only (no terminal, no file, no web, no
#                            messaging, no memory writes); TTS `edge` and local STT, so a spoken
#                            call spends nothing.
# The previous config.yaml and SOUL.md go to backups/<UTC stamp>/ first.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
HH="${HERMES_ROOT:-$HOME/.hermes}"
P="$HH/profiles/decision-call"
PY="$HH/hermes-agent/venv/bin/python"

# WHICH HERMES: the Desktop's backend is the one whose profiles a Desktop chat can open. On this Mac
# that is the BOX (the Desktop dials 127.0.0.1:9119, an ssh tunnel to the box's hermes-serve), so the
# profile must be installed there: `install.sh --box` copies the sources over and runs this script on
# the box. A Mac-only install serves `hermes -p decision-call chat` in a Mac terminal, nothing more.
if [[ "${1:-}" == "--box" ]]; then
  HOST="${BOX:-dgx-remote}"; D=".local/share/lucky-loop/decision-call-src"
  ssh -o BatchMode=yes "$HOST" "mkdir -p $D/hermes/plugins/decision-call $D/hermes/profiles/decision-call"
  scp -q "$REPO_ROOT/hermes/plugins/decision-call/__init__.py" "$REPO_ROOT/hermes/plugins/decision-call/plugin.yaml" \
    "$HOST:$D/hermes/plugins/decision-call/"
  scp -q "$HERE/SOUL.md" "$HERE/install.sh" "$HOST:$D/hermes/profiles/decision-call/"
  ssh -o BatchMode=yes "$HOST" "bash ~/$D/hermes/profiles/decision-call/install.sh ${2:-}"
  exit $?
fi

if [[ "${1:-}" == "--check" ]]; then
  ls -la "$P/plugins/decision-call" 2>/dev/null || echo "plugin: not installed"
  "$PY" - "$P/config.yaml" <<'EOF'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1]))
print("toolsets:", c.get("platform_toolsets"), "| plugins:", c.get("plugins"))
print("gbrain tools:", len(((c.get("mcp_servers") or {}).get("gbrain") or {}).get("tools", {}).get("include", [])), "allowlisted")
print("tts:", (c.get("tts") or {}).get("provider"), "| stt:", (c.get("stt") or {}).get("provider"))
EOF
  exit 0
fi

HERMES_BIN="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
[[ -x "$HERMES_BIN" ]] || { echo "no hermes binary found" >&2; exit 1; }
[[ -d "$P" ]] || "$HERMES_BIN" profile create decision-call --no-skills --no-alias \
  --description "The decision call: presents one needs-you card, discusses its effects, and records Karl's word only after an explicit yes."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$P/backups/$STAMP"
for f in config.yaml SOUL.md; do [[ -f "$P/$f" ]] && cp -p "$P/$f" "$P/backups/$STAMP/$f"; done
[[ -d "$P/plugins/decision-call" ]] && cp -Rp "$P/plugins/decision-call" "$P/backups/$STAMP/plugin"

# The plugin, atomically (a half-copied plugin must never load).
mkdir -p "$P/plugins"
TMP="$(mktemp -d "$P/plugins/.decision-call.XXXX")"
cp "$REPO_ROOT/hermes/plugins/decision-call/plugin.yaml" "$REPO_ROOT/hermes/plugins/decision-call/__init__.py" "$TMP/"
rm -rf "$P/plugins/decision-call.old"
[[ -d "$P/plugins/decision-call" ]] && mv "$P/plugins/decision-call" "$P/plugins/decision-call.old"
mv "$TMP" "$P/plugins/decision-call"
rm -rf "$P/plugins/decision-call.old"

cp "$HERE/SOUL.md" "$P/SOUL.md.tmp" && mv "$P/SOUL.md.tmp" "$P/SOUL.md"

"$PY" - "$HH/config.yaml" "$P/config.yaml" <<'EOF'
import os, sys, yaml
main = yaml.safe_load(open(sys.argv[1])) or {}
gb = ((main.get("mcp_servers") or {}).get("gbrain") or {})
if not gb.get("tools", {}).get("include"):
    sys.exit("refused: the main config's gbrain server has no tools.include allowlist; the call gets read-only tools or none")
cfg = {
    "model": main.get("model"),
    "plugins": {"enabled": ["decision-call"]},
    # The Desktop resolves a session's tools from the `cli` list (+ its own GUI affordances).
    "platform_toolsets": {"cli": ["decision_call"]},
    "mcp_servers": {"gbrain": gb},
    "memory": {"memory_enabled": False, "user_profile_enabled": False},
    "agent": {"max_turns": 40, "reasoning_effort": "none"},
    "terminal": {"backend": "local", "cwd": os.path.expanduser("~/.hermes/profiles/decision-call/workspace")},
    "stt": {"enabled": True, "provider": "local", "local": {"model": "base"}},
    "tts": {"provider": "edge"},
    "voice": {"voice_chat_mode": "chained"},
    "_config_version": main.get("_config_version", 45),
}
tmp = sys.argv[2] + ".tmp"
with open(tmp, "w") as f:
    f.write("# Generated by lucky-loop hermes/profiles/decision-call/install.sh — edit the installer, not this file.\n")
    yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)
os.replace(tmp, sys.argv[2])
print("config.yaml written:", len(gb["tools"]["include"]), "gbrain tools allowlisted; toolsets", cfg["platform_toolsets"]["cli"])
EOF
if [[ "$(uname)" == "Linux" ]]; then
  # On the box the writer's own clone IS the box clone: its "did the box take it" check reads this HEAD.
  touch "$P/.env"; chmod 600 "$P/.env"
  grep -v '^NYW_BOX_CMD=' "$P/.env" > "$P/.env.tmp" || true
  echo "NYW_BOX_CMD=git -C $HOME/brain rev-parse HEAD" >> "$P/.env.tmp"
  chmod 600 "$P/.env.tmp"; mv "$P/.env.tmp" "$P/.env"
fi
"$PY" "$P/plugins/decision-call/__init__.py" --selftest | tail -1
echo "installed. backup: $P/backups/$STAMP"

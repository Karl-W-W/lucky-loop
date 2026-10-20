#!/usr/bin/env bash
# SWITCH 1 — Claude Code panes as Hermes room members. STAGED, OFF. Not before 2026-10-01 (Karl's
# rule 5 slot; the board row `shim-claude-code-agents-in-hermes-rooms`). Runs on the Mac, where the
# panes and `claude` live. See hermes/profiles/decision-call/SWITCHES.md.
#
#   shim-switch.sh stage                          copy cc-shim.py + its LaunchAgent to a staging dir. Loads nothing.
#   shim-switch.sh status                         staged? on? which seats? (never prints the token)
#   shim-switch.sh flip <seat> <session-id> [cwd] ON/AFTER 10-01 ONLY: seat one Claude Code session, start the shim,
#                                                 create the Hermes profile cc-<seat> that talks to it
#   shim-switch.sh off                            stop the shim, flag off (seats and profile stay; nothing answers)
#
# After flip, the room is Karl's click: Hermes Desktop → Bot Mode → New Agent from profile cc-<seat> → add it
# to a room. The seat answers in plan mode (it reads and answers; it does not act) unless seats.json says
# otherwise, and bypassPermissions is refused by the shim in code.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE="$HOME/.local/share/lucky-loop/cc-shim"
CONF="$HOME/.config/lucky-loop/cc-shim"
LABEL="com.lucky-loop.cc-shim"
PLIST_STAGED="$STAGE/$LABEL.plist"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=11610
HH="$HOME/.hermes"
PY="$HH/hermes-agent/venv/bin/python"
# $SYSPY can be blocked by an unaccepted Xcode licence; prefer a real install.
SYSPY="$(for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3)"; do [[ -x "$c" ]] && echo "$c" && break; done)"

case "${1:-}" in
stage)
  mkdir -p "$STAGE" "$CONF"; chmod 700 "$CONF"
  cp "$HERE/cc-shim.py" "$STAGE/cc-shim.py.tmp" && mv "$STAGE/cc-shim.py.tmp" "$STAGE/cc-shim.py"
  [[ -f "$CONF/on" ]] || echo off > "$CONF/on"
  # The plist stays in the staging dir: a plist in ~/Library/LaunchAgents would load at the next login.
  cat > "$PLIST_STAGED" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$SYSPY</string><string>$STAGE/cc-shim.py</string><string>serve</string><string>--port</string><string>$PORT</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardErrorPath</key><string>$HOME/.local/state/lucky-loop/cc-shim/stderr.log</string>
</dict></plist>
EOF
  $SYSPY "$STAGE/cc-shim.py" --selftest | tail -1
  echo "staged OFF at $STAGE (flag: $(cat "$CONF/on")). Nothing is loaded; flip refuses before 2026-10-01."
  ;;
status)
  echo "staged: $([[ -f $STAGE/cc-shim.py ]] && echo yes || echo no) · flag: $(cat "$CONF/on" 2>/dev/null || echo absent) · token: $([[ -s $CONF/token ]] && echo present || echo absent)"
  echo "seats: $($SYSPY -c "import json,sys;print(', '.join(json.load(open(sys.argv[1]))) or 'none')" "$CONF/seats.json" 2>/dev/null || echo none)"
  echo "launchd: $(launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo loaded || echo 'not loaded')"
  ;;
flip)
  SEAT="${2:-}"; SID="${3:-}"; CWD="${4:-$HOME}"
  [[ "$(date +%F)" > "2026-09-30" ]] || { echo "refused: not before 2026-10-01 (Karl's rule 5 slot for October)" >&2; exit 2; }
  [[ "$SEAT" =~ ^[a-z][a-z0-9-]{1,30}$ && -n "$SID" ]] || { echo "usage: shim-switch.sh flip <seat> <claude-session-id> [cwd]" >&2; exit 2; }
  [[ -f "$STAGE/cc-shim.py" ]] || "$0" stage
  [[ -s "$CONF/token" ]] || { umask 077; $SYSPY -c "import secrets;print(secrets.token_urlsafe(32))" > "$CONF/token"; }
  chmod 600 "$CONF/token"
  $SYSPY - "$CONF/seats.json" "$SEAT" "$SID" "$CWD" <<'EOF'
import json, os, sys
p, seat, sid, cwd = sys.argv[1:]
d = json.load(open(p)) if os.path.exists(p) else {}
d[seat] = {"session": sid, "cwd": cwd, "mode": "plan"}
open(p + ".tmp", "w").write(json.dumps(d, indent=1)); os.replace(p + ".tmp", p)
EOF
  echo on > "$CONF/on"
  mkdir -p "$HOME/.local/state/lucky-loop/cc-shim"
  cp "$PLIST_STAGED" "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  P="$HH/profiles/cc-$SEAT"
  [[ -d "$P" ]] || hermes profile create "cc-$SEAT" --no-skills --no-alias --description "Claude Code seat $SEAT, through the cc-shim (answers in plan mode)."
  "$PY" - "$P" "$SEAT" "$PORT" "$CONF/token" <<'EOF'
import os, sys, yaml
p, seat, port, tokf = sys.argv[1:]
cfg = {"model": {"provider": "custom", "base_url": f"http://127.0.0.1:{port}/v1", "default": seat, "key_env": "CC_SHIM_TOKEN"},
       "platform_toolsets": {"cli": []},  # the Claude Code session has its own tools; Hermes gives it none
       "memory": {"memory_enabled": False, "user_profile_enabled": False}, "_config_version": 45}
open(os.path.join(p, "config.yaml"), "w").write(yaml.safe_dump(cfg, sort_keys=False))
env = os.path.join(p, ".env")
lines = [l for l in (open(env).read().splitlines() if os.path.exists(env) else []) if not l.startswith("CC_SHIM_TOKEN=")]
lines.append("CC_SHIM_TOKEN=" + open(tokf).read().strip())
open(env, "w").write("\n".join(lines) + "\n"); os.chmod(env, 0o600)
EOF
  echo "on: shim loaded on 127.0.0.1:$PORT, seat $SEAT → profile cc-$SEAT. Room membership is your click in Bot Mode."
  ;;
off)
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  mkdir -p "$CONF"; echo off > "$CONF/on"
  echo "off: shim unloaded, flag off, LaunchAgent removed (staged copy kept)."
  ;;
*) sed -n 2,17p "$0"; exit 2 ;;
esac

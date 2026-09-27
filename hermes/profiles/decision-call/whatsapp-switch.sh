#!/usr/bin/env bash
# SWITCH 2 — WhatsApp answers. STAGED, OFF. The flip is Karl's: his phone pairs the number, and the
# 09-10 "no WhatsApp" ruling stands until his word. See hermes/profiles/decision-call/SWITCHES.md.
#
# WHY THE PROFILE IS KEPT OUTSIDE ~/.hermes/profiles UNTIL THE FLIP (verifier blocker 2, 2026-09-27):
# the box's gateway multiplexes profiles (gateway/run.py `_multiplex_profile_homes` ->
# hermes_cli/profiles.py `profiles_to_serve(multiplex=True)`: default + EVERY live named profile under
# profiles/). There is no per-profile exclude key, and its reconcile watcher rescans profiles/ and
# every served profile's .env about every 30 s. So a staged profile that sat under profiles/ was
# SERVED, and setting WHATSAPP_ENABLED=true there would have started the adapter inside the main
# gateway on its own. The staged profile therefore lives in STAGED below, served by nothing; `flip`
# moves it into profiles/ (the gateway picks it up) and is the ONLY step that turns WhatsApp on.
# No separate systemd unit: the main gateway serves it once it is under profiles/, and a second
# gateway would double-serve the same number.
#
# Runs ON THE BOX. From the Mac, in this repo:
#   hermes/profiles/decision-call/whatsapp-switch.sh push     copy the sources to the box, run `stage` there
#
#   whatsapp-switch.sh stage    build/refresh the profile in STAGED, WhatsApp disabled, served by nothing
#   whatsapp-switch.sh status   where it is, whether it is on, whether the gateway serves it (never the number)
#   whatsapp-switch.sh flip     KARL, in a terminal: his number (hidden) -> into profiles/ -> pair the
#                               separate number's phone -> WHATSAPP_ENABLED=true. The one switch.
#   whatsapp-switch.sh off      WHATSAPP_ENABLED=false, then back out of profiles/ into STAGED
#                               (`off --forget` also removes the number)
#
# Once on, the profile has the SAME three tools as the Desktop call (hermes/plugins/decision-call) and
# nothing else on any platform: read a card, read a word back, record it when Karl's next message
# names the word (tier 3: names it twice), through the box's vault writer, doneBy
# "karl — whatsapp <word>". It answers only in the chat it was written in. dm_policy allowlist with
# only Karl's number; groups disabled. Why not the page's POST /answer: that route takes only the
# Mac-only page key; putting the key on the box would undo the page's channel. So it writes through
# the same WRITER as verb (a) (needs-you-write, the same id/word validation), not through its route.
set -euo pipefail
P_NAME=decision-whatsapp
SRC="${DECISION_CALL_SRC:-$HOME/.local/share/lucky-loop/decision-call-src}"
STAGED="$HOME/.local/share/lucky-loop/$P_NAME-staged"
HH="$HOME/.hermes"
LIVE="$HH/profiles/$P_NAME"
PY="$HH/hermes-agent/venv/bin/python"
HERMES="$HOME/.local/bin/hermes"
GWLOG="$HH/logs/gateway.log"

# A dir under profiles/ is a profile only with an identity marker (hermes_constants
# named_profile_has_identity). After the move out, the gateway's per-profile log router leaves a
# marker-less GHOST (logs/ only) behind: not listed, not served. `live` ignores it; flip clears it.
live() {
  local m; for m in config.yaml .env SOUL.md profile.yaml auth.json state.db; do
    [[ -f "$LIVE/$m" || -L "$LIVE/$m" ]] && return 0; done; return 1
}
clear_ghost() {  # move a marker-less ghost's logs into the staged profile, then remove the empty dir
  [[ -d "$LIVE" ]] && ! live || return 0
  local extra; extra="$(find "$LIVE" -mindepth 1 -not -path "$LIVE/logs" -not -path "$LIVE/logs/*" | head -1)"
  [[ -z "$extra" ]] || { echo "refused: $LIVE holds more than logs ($extra); look at it by hand" >&2; exit 2; }
  local g; g="$1/logs/ghost-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$g"
  [[ -d "$LIVE/logs" ]] && mv "$LIVE/logs/"* "$g/" 2>/dev/null || true
  rmdir "$LIVE/logs" 2>/dev/null || true; rmdir "$LIVE"
}
where() { if live; then echo "$LIVE"; elif [[ -d "$STAGED" ]]; then echo "$STAGED"; fi; }
setenv() {  # setenv DIR KEY VALUE — replace or append one line in DIR/.env (0600)
  local f="$1/.env" tmp; touch "$f"; chmod 600 "$f"
  tmp="$(mktemp "$1/.env.XXXX")"; grep -v "^$2=" "$f" > "$tmp" || true
  printf '%s=%s\n' "$2" "$3" >> "$tmp"; chmod 600 "$tmp"; mv "$tmp" "$f"
}
getenv() { grep "^$2=" "$1/.env" 2>/dev/null | tail -1 | cut -d= -f2-; }
policy() {  # the fixed WhatsApp policy, re-asserted after anything that may have edited .env
  setenv "$1" WHATSAPP_MODE bot
  setenv "$1" WHATSAPP_DM_POLICY allowlist
  setenv "$1" WHATSAPP_GROUP_POLICY disabled
  setenv "$1" WHATSAPP_ALLOW_ALL_USERS false
  setenv "$1" NYW_BOX_CMD "git -C $HOME/brain rev-parse HEAD"
}
served() {  # the multiplexer logs a profile's own lines (incl. "deleted ... unrouted") into THAT profile's log
  cat "$GWLOG" "$LIVE/logs/gateway.log" "$STAGED/logs/gateway.log" "$STAGED"/logs/ghost-*/gateway.log 2>/dev/null \
    | grep "MULTIPLEX" | grep "'$P_NAME'" | sort | tail -1
}

case "${1:-}" in
push)  # from the Mac
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
  HOST="${BOX:-dgx-remote}"
  ssh -o BatchMode=yes "$HOST" 'mkdir -p ~/.local/share/lucky-loop/decision-call-src'
  scp -q "$ROOT/hermes/plugins/decision-call/__init__.py" "$ROOT/hermes/plugins/decision-call/plugin.yaml" \
    "$HERE/SOUL.md" "$HERE/profile_config.py" "$HERE/whatsapp-switch.sh" "$HOST:.local/share/lucky-loop/decision-call-src/"
  ssh -o BatchMode=yes "$HOST" 'bash ~/.local/share/lucky-loop/decision-call-src/whatsapp-switch.sh stage'
  ;;
stage)
  live && { echo "refused: $P_NAME is LIVE under profiles/ — run \`off\` first; stage never touches a live profile" >&2; exit 2; }
  if [[ ! -d "$STAGED" ]]; then
    # Build it once with the vendor's create (identity marker etc.), then move it out at once.
    [[ -x "$HERMES" ]] || { echo "no hermes at $HERMES" >&2; exit 1; }
    "$HERMES" profile create "$P_NAME" --no-skills --no-alias \
      --description "Decision answers over WhatsApp: one card, Karl's word read back, recorded only when he names it."
    setenv "$LIVE" WHATSAPP_ENABLED false
    mkdir -p "$(dirname "$STAGED")"; mv "$LIVE" "$STAGED"
  fi
  P="$STAGED"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$P/backups/$STAMP"
  for f in config.yaml SOUL.md .env; do [[ -f "$P/$f" ]] && cp -p "$P/$f" "$P/backups/$STAMP/"; done
  mkdir -p "$P/plugins/decision-call.new"
  cp "$SRC/__init__.py" "$SRC/plugin.yaml" "$P/plugins/decision-call.new/"
  rm -rf "$P/plugins/decision-call"; mv "$P/plugins/decision-call.new" "$P/plugins/decision-call"
  { cat "$SRC/SOUL.md"; printf '\n## Over WhatsApp\n\nYou are reached by text on WhatsApp, not by voice. Keep replies to a few lines. Start a\ncall only when Karl names a card or says "next". Never send anything first.\n'; } > "$P/SOUL.md"
  (cd "$HH/hermes-agent" && "$PY" "$SRC/profile_config.py" write "$HH/config.yaml" "$P/config.yaml" whatsapp)
  setenv "$P" WHATSAPP_ENABLED false
  policy "$P"
  "$PY" "$P/plugins/decision-call/__init__.py" --selftest | tail -1
  echo "staged OFF in $STAGED — outside profiles/, served by nothing. Backup: $P/backups/$STAMP"
  ;;
status)
  P="$(where)"
  echo "profile: ${P:-absent} $([[ "$P" == "$LIVE" ]] && echo '(LIVE under profiles/)' || echo '(staged, served by nothing)')$([[ -d "$LIVE" ]] && ! live && echo ' · a marker-less log ghost sits under profiles/ (not a profile, not served)')"
  echo "gateway serves: $("$PY" -c "import json,sys;d=json.load(open(sys.argv[1]));print(('YES' if sys.argv[2] in d.get('served_profiles',[]) else 'no'), 'as of', d.get('updated_at'))" "$HH/gateway_state.json" "$P_NAME" 2>/dev/null || echo unknown)"
  [[ -n "$P" ]] && echo "WHATSAPP_ENABLED=$(getenv "$P" WHATSAPP_ENABLED) · mode=$(getenv "$P" WHATSAPP_MODE) · dm_policy=$(getenv "$P" WHATSAPP_DM_POLICY) · allowlist: $([[ -n "$(getenv "$P" WHATSAPP_ALLOWED_USERS)" ]] && echo 'one number set' || echo empty)"
  w="$(served || true)"; echo "gateway's last word on it: ${w:-none}"
  ;;
flip)
  [[ -t 0 ]] || { echo "refused: flip reads Karl's number from a terminal (hidden input); run it yourself on the box" >&2; exit 2; }
  [[ -d "$STAGED" ]] && ! live || { echo "refused: nothing staged (or already live); run stage / status" >&2; exit 2; }
  read -r -s -p "Your own WhatsApp number, digits only with country code (hidden; kept only in the profile's .env on this box): " NUM; echo
  [[ "$NUM" =~ ^[0-9]{8,15}$ ]] || { echo "refused: digits only, 8-15 of them" >&2; exit 2; }
  setenv "$STAGED" WHATSAPP_ALLOWED_USERS "$NUM"; unset NUM
  setenv "$STAGED" WHATSAPP_ENABLED false
  policy "$STAGED"
  clear_ghost "$STAGED"
  mv "$STAGED" "$LIVE"   # the gateway now serves it, still with 0 adapters
  echo "Pairing: scan the QR with the SEPARATE number's phone."
  if ! "$HERMES" -p "$P_NAME" whatsapp; then
    echo "pairing did not finish; WhatsApp stays disabled. Run \`off\` to take the profile back out." >&2; exit 1
  fi
  NUM="$(getenv "$LIVE" WHATSAPP_ALLOWED_USERS)"; policy "$LIVE"; setenv "$LIVE" WHATSAPP_ALLOWED_USERS "$NUM"; unset NUM
  setenv "$LIVE" WHATSAPP_ENABLED true   # the gateway's watcher starts the adapter within ~30 s
  echo "ON. From YOUR phone, message the separate number: next"
  ;;
off)
  if live; then
    setenv "$LIVE" WHATSAPP_ENABLED false
    [[ "${2:-}" == "--forget" ]] && setenv "$LIVE" WHATSAPP_ALLOWED_USERS ""
    sleep 40   # let the watcher tear the adapter down before the profile leaves profiles/
    [[ -d "$STAGED" ]] && { echo "refused: $STAGED already exists; resolve by hand" >&2; exit 2; }
    mv "$LIVE" "$STAGED"
  elif [[ "${2:-}" == "--forget" && -d "$STAGED" ]]; then
    setenv "$STAGED" WHATSAPP_ALLOWED_USERS ""
  fi
  echo "off: WHATSAPP_ENABLED=false, profile in $STAGED (served by nothing)$([[ "${2:-}" == "--forget" ]] && echo ', number removed')"
  ;;
*) sed -n 2,30p "$0"; exit 2 ;;
esac

#!/bin/bash
# herdr-snapshot — every 60 s, the SHAPE of the Mac's interactive agents, copied to the loop host.
#
# Feeds the "Agents now" block on the Today page (Karl's plan 2026-09-16, L3): one roster
# for the agents on this Mac (herdr panes) and the agents on the box (user units), so the
# question "who is working right now" has one answer in one place.
#
# SHAPE ONLY. `herdr agent list` returns terminal titles and full paths; none of that
# leaves this machine. What crosses: name, pane, workspace, state, the cwd BASENAME, and
# `since` (when this snapshot first saw the pane in its current state). A terminal title
# is a task description; a full path is a map of this laptop.
#
# Empty is a state, not an error: no herdr socket, or herdr not answering, writes
# {syncedAt, agents: [], note: "herdr not running"} — the page renders that, dated.
#
# Atomic at both ends: tmp + mv here, scp to .tmp + mv on the box. A half-written JSON
# is never what the backend reads. The box copy is `~/.local/state/lucky-loop/
# herdr-agents.json`; the Today backend flags it stale past 3 minutes.
#
# Scheduled by deploy/com.kww.herdr-snapshot.plist (launchd, StartInterval 60, RunAtLoad).
# The plist runs THIS file from the repo checkout, so the versioned copy is the running copy.
set -u
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

HOST="${LL_DGX_HOST:-dgx-remote}"            # the same ssh alias every other script here uses
STATE_DIR="$HOME/.local/state/lucky-loop"
OUT="$STATE_DIR/herdr-agents.json"
SEEN="$STATE_DIR/herdr-snapshot.seen.json"   # pane -> {state, since}, for `since`
LOG="$STATE_DIR/herdr-snapshot.log"          # failures only; silence is success
REMOTE_DIR=".local/state/lucky-loop"
REMOTE="$REMOTE_DIR/herdr-agents.json"
SOCK="$HOME/.config/herdr/herdr.sock"

mkdir -p "$STATE_DIR"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

raw=""
if [ -S "$SOCK" ]; then
  raw=$(herdr agent list </dev/null 2>/dev/null) || raw=""
fi

HERDR_RAW="$raw" python3 - "$now" "$OUT" "$SEEN" <<'PY'
import json, os, sys
now, out_path, seen_path = sys.argv[1], sys.argv[2], sys.argv[3]
raw = os.environ.get("HERDR_RAW", "")
STATES = {"working", "blocked", "idle", "done"}
try:
    agents = json.loads(raw)["result"]["agents"]
except Exception:
    agents = None
try:
    seen = json.load(open(seen_path))
except Exception:
    seen = {}
rows, seen_now = [], {}
for a in agents or []:
    pane = str(a.get("pane_id") or "")
    state = a.get("agent_status") if a.get("agent_status") in STATES else "unknown"
    prev = seen.get(pane)
    since = prev["since"] if prev and prev.get("state") == state else now
    seen_now[pane] = {"state": state, "since": since}
    rows.append({
        "name": a.get("name") or pane.replace(":", "-"),
        "pane": pane,
        "workspace": a.get("workspace_id"),
        "state": state,
        "cwd_base": os.path.basename((a.get("cwd") or "").rstrip("/")) or None,
        "since": since,
    })
rows.sort(key=lambda r: (r["workspace"] or "", r["pane"]))
snap = {"syncedAt": now, "host": "mac", "agents": rows}
if agents is None:
    snap["note"] = "herdr not running"
tmp = out_path + ".tmp"
with open(tmp, "w") as f:
    json.dump(snap, f, indent=1)
    f.write("\n")
os.replace(tmp, out_path)
with open(seen_path + ".tmp", "w") as f:
    json.dump(seen_now, f)
os.replace(seen_path + ".tmp", seen_path)
PY

# to the box: atomic there too. One ssh round-trip for the mkdir+mv keeps it cheap.
if scp -q -o BatchMode=yes -o ConnectTimeout=10 "$OUT" "$HOST:$REMOTE.tmp" 2>/dev/null \
   && ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "mkdir -p $REMOTE_DIR && mv -f $REMOTE.tmp $REMOTE" 2>/dev/null; then
  exit 0
fi
echo "$now copy-to-host failed (snapshot written locally)" >> "$LOG"
exit 1

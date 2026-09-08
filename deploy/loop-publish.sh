#!/bin/bash
# loop-publish — the Mac half of the artifact-return hop (see docs/AUTONOMY.md).
# Versioned here; installed as ~/.local/bin/loop-publish and scheduled by
# deploy/com.kww.loop-publish.plist (launchd, every 6 h).
#
# Pulls the loop's artifacts off the loop host (npm run sync:loop), regenerates the
# canvas so the drift gate can pass on a new pass count, runs the publication gates,
# and commits + pushes to origin main ONLY when every gate is green. Red gates restore
# the committed bytes and push NOTHING — not even a branch: on a public repo a branch
# push is a publication too.
#
# One log line per run in ~/.config/loop-publish.log:
#   <utc> fetched=<passes on host> new=<not yet committed> gates=<green|red|skipped> pushed=<yes|no> reason=<why>
#
# Idempotent: when runs and definition are unchanged and the committed status snapshot
# is younger than STATUS_MAX_AGE_H, the fresh snapshot is discarded and nothing is
# committed. Past that age the snapshot is re-published so /war's panel never crosses
# its own 24 h "stale" line while this job is healthy.
set -u

# --dry-run: fetch, gate and log exactly as a real run, then restore the committed
# bytes instead of committing and pushing. The log line says what WOULD have shipped.
DRY_RUN=0; [ "${1:-}" = "--dry-run" ] && DRY_RUN=1

REPO="${LOOP_PUBLISH_REPO:-$HOME/Projects/lucky-loop}"
LOG="$HOME/.config/loop-publish.log"
LOCK="$HOME/.config/loop-publish.lock"
STATUS_MAX_AGE_H=12
SYNC_PATHS=(data/loop-runs.json data/loop-def.json data/loop-status.json)
CANVAS=langflow/lucky-loop-architecture.json
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$(dirname "$LOG")"
fetched="?"; new="?"; gates="skipped"; pushed="no"
finish() {  # $1 = reason; $2 = exit code
  printf '%s fetched=%s new=%s gates=%s pushed=%s %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$fetched" "$new" "$gates" "$pushed" "$1" >> "$LOG"
  rmdir "$LOCK" 2>/dev/null
  exit "$2"
}
restore() { git -C "$REPO" checkout -q -- "${SYNC_PATHS[@]}" "$CANVAS" 2>/dev/null; }

if ! mkdir "$LOCK" 2>/dev/null; then
  printf '%s fetched=? new=? gates=skipped pushed=no reason=another-run-holds-the-lock\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"; exit 0
fi
cd "$REPO" || finish "reason=repo-missing" 1

# --- preconditions: only ever act on a clean main that is not behind origin ---------
[ "$(git branch --show-current)" = "main" ] || finish "reason=not-on-main" 0
if [ -n "$(git status --porcelain -- "${SYNC_PATHS[@]}" "$CANVAS")" ]; then
  finish "reason=sync-paths-dirty-before-start" 0
fi
git fetch -q origin main || finish "reason=fetch-failed" 1
behind=$(git rev-list --count HEAD..origin/main)
ahead=$(git rev-list --count origin/main..HEAD)
if [ "$ahead" -gt 0 ]; then finish "reason=local-main-has-unpushed-human-commits" 0; fi
if [ "$behind" -gt 0 ]; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] || finish "reason=behind-origin-and-tree-dirty" 0
  git pull -q --ff-only origin main || finish "reason=ff-pull-failed" 1
fi

# --- hop: fetch the artifacts (counts only; the host writes nothing) -----------------
out=$(npm run --silent sync:loop 2>&1) || { restore; finish "reason=sync-failed:host-unreachable-or-guard" 1; }
fetched=$(printf '%s\n' "$out" | sed -n 's/^sync-loop: \([0-9][0-9]*\) pass(es) on the host.*/\1/p' | head -1)
committed=$(printf '%s\n' "$out" | sed -n 's/^sync-loop: [0-9]* pass(es) on the host, \([0-9][0-9]*\) committed.*/\1/p' | head -1)
if [ -n "$fetched" ] && [ -n "$committed" ]; then new=$((fetched - committed)); else new="?"; fi

# --- idempotence: publish only on new passes or an ageing snapshot -------------------
runs_changed=1; git diff --quiet -- data/loop-runs.json data/loop-def.json && runs_changed=0
prev_synced=$(git show HEAD:data/loop-status.json | sed -n 's/.*"syncedAt": *"\([^"]*\)".*/\1/p')
prev_epoch=$(date -j -u -f %Y-%m-%dT%H:%M:%SZ "$prev_synced" +%s 2>/dev/null || echo 0)
age_h=$(( ( $(date -u +%s) - prev_epoch ) / 3600 ))
if [ "$runs_changed" -eq 0 ] && [ "$age_h" -lt "$STATUS_MAX_AGE_H" ]; then
  restore; finish "reason=unchanged(snapshot-age=${age_h}h)" 0
fi

# --- gates: canvas regenerated (node titles derive the pass count), then every gate --
gates="red"
python3 langflow/gen-flow.py >/dev/null 2>&1              || { restore; finish "reason=canvas-regen-failed" 1; }
python3 loop/check_artifacts.py >/dev/null 2>&1           || { restore; finish "reason=redaction-gate-red" 1; }
python3 loop/test_redaction.py >/dev/null 2>&1            || { restore; finish "reason=redaction-tests-red" 1; }
python3 langflow/gen-flow.py --check-drift >/dev/null 2>&1 || { restore; finish "reason=drift-gate-red" 1; }
gates="green"

# --- publish: exactly these paths, nothing else in the tree ---------------------------
what="status snapshot"
[ "$runs_changed" -eq 1 ] && what="${new} new pass(es), canvas regenerated"
if [ "$DRY_RUN" -eq 1 ]; then restore; finish "reason=dry-run(would-publish:${what})" 0; fi
git add -- "${SYNC_PATHS[@]}" "$CANVAS"
git diff --cached --quiet && finish "reason=nothing-staged" 0
git commit -q -m "loop-publish: ${what} — ${fetched} pass(es) on the host

Automated by ~/.local/bin/loop-publish (launchd com.kww.loop-publish, every 6 h).
Gates run on this Mac with the local deny-list loaded: redaction, its tests, drift.
Nothing is pushed when any gate is red." || { restore; finish "reason=commit-failed" 1; }
git push -q origin main || finish "reason=push-failed(commit-kept-local)" 1
[ "$(git rev-list --count origin/main..HEAD)" -eq 0 ] && pushed="yes"
finish "reason=published(${what})" 0

#!/usr/bin/env bash
# Regenerate the architecture flow and push it into the running Langflow Desktop.
#
#   ./langflow/push-flow.sh            regenerate + upsert into Langflow
#   ./langflow/push-flow.sh --check    verify every source excerpt still resolves
#
# Langflow Desktop runs a backend on 127.0.0.1:7860 with auto-login enabled, so
# no API key is needed and nothing here reads a credential. If the desktop app
# is not running, this exits non-zero and changes nothing.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LF="${LANGFLOW_URL:-http://127.0.0.1:7860}"
FLOW_JSON="$REPO/langflow/lucky-loop-architecture.json"
PROJECT_NAME="Lucky Loop — Architecture"
FLOW_NAME="Lucky Loop — Backend Architecture"

if [[ "${1:-}" == "--check" ]]; then
  exec python3 "$REPO/langflow/gen-flow.py" --check
fi

python3 "$REPO/langflow/gen-flow.py"

if ! curl -sf -m 5 "$LF/health" >/dev/null 2>&1 && ! curl -sf -m 5 "$LF/api/v1/version" >/dev/null 2>&1; then
  echo "push-flow: no Langflow backend at $LF — open Langflow Desktop first." >&2
  exit 1
fi

TOKEN="$(curl -s -m 15 "$LF/api/v1/auto_login" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# Reuse the project and the flow if they already exist, so repeated pushes
# update one canvas instead of littering Langflow with copies.
PROJECT_ID="$(curl -s --compressed -m 15 "${AUTH[@]}" "$LF/api/v1/projects/" \
  | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if p.get('name') == '''$PROJECT_NAME''':
        print(p['id']); break
")"

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(curl -s --compressed -m 15 -X POST "${AUTH[@]}" \
    -d "{\"name\":\"$PROJECT_NAME\",\"description\":\"Generated mirror of the lucky-loop backend\"}" \
    "$LF/api/v1/projects/" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
  echo "push-flow: created project $PROJECT_ID"
fi

FLOW_ID="$(curl -s --compressed -m 20 "${AUTH[@]}" "$LF/api/v1/flows/?header_flows=true" \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for f in (d if isinstance(d, list) else d.get('items', [])):
    if f.get('name') == '''$FLOW_NAME''' and f.get('folder_id') == '''$PROJECT_ID''':
        print(f['id']); break
")"

BODY="$(python3 -c "
import json,sys
f = json.load(open('$FLOW_JSON'))
f['folder_id'] = '$PROJECT_ID'
f.pop('id', None)
json.dump(f, sys.stdout)
")"

if [[ -n "$FLOW_ID" ]]; then
  echo "$BODY" | curl -s --compressed -m 60 -X PATCH "${AUTH[@]}" --data-binary @- \
    "$LF/api/v1/flows/$FLOW_ID" -o /dev/null -w "push-flow: updated flow $FLOW_ID (http %{http_code})\n"
else
  echo "$BODY" | curl -s --compressed -m 60 -X POST "${AUTH[@]}" --data-binary @- \
    "$LF/api/v1/flows/" \
    | python3 -c 'import json,sys; print("push-flow: created flow", json.load(sys.stdin)["id"])'
fi

echo "push-flow: open Langflow Desktop -> Projects -> $PROJECT_NAME"

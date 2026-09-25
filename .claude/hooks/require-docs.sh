#!/usr/bin/env bash
# Stop: block once if source changed since the last docs update.
# A turn that only read, answered a question or fixed a typo is never blocked.
set -uo pipefail
source "$(dirname "$0")/state.sh" 2>/dev/null || exit 0

payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)"

# Set by the harness when a Stop hook already blocked this turn. The state file is
# cleared below as well, so a turn can be blocked at most once either way.
active="$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
[ "$active" = "true" ] && exit 0

file="$(state_file "$session")"
[ -f "$file" ] || exit 0
grep -q '^src$' "$file" || exit 0

rm -f "$file"

cat <<'JSON'
{
  "decision": "block",
  "reason": "This session changed code under src/ but has not updated the docs ledger since. Before finishing, append to the ones that apply:\n\n  docs/EXECUTION.md  — a timestamped entry: Context / Action / Result / Files touched.\n  docs/LEARNINGS.md  — only if something cost you time: Problem / Root cause / Fix / Rule.\n  docs/INTERFACE.md  — only if a UI, design-token, state or architecture decision was made or changed.\n\nEXECUTION.md is almost always the right one. Keep entries short and specific; these files are what a fresh session reads instead of asking."
}
JSON
exit 0

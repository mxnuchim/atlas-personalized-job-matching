#!/usr/bin/env bash
# SessionStart: put the docs ledger into context so a new session inherits the history.
set -uo pipefail
cat >/dev/null 2>&1 || true   # drain stdin

root="$(cd "$(dirname "$0")/../.." && pwd)"
context=""

for doc in EXECUTION LEARNINGS INTERFACE; do
  path="$root/docs/$doc.md"
  [ -f "$path" ] || continue
  # Cap each file so a growing ledger can't crowd out the actual task. Truncate by
  # LINES, not bytes: these docs contain multi-byte characters, and a byte-cut mid
  # character produces invalid UTF-8 that jq then emits as unescapable JSON.
  body="$(head -n 400 "$path")"
  context+=$'\n\n===== docs/'"$doc"$'.md =====\n'"$body"
done

[ -n "$context" ] || exit 0

jq -n --arg ctx "Project docs ledger (read these before planning; keep them current as you work):$context" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
exit 0

#!/usr/bin/env bash
# PostToolUse (Write|Edit): record whether this session touched source or the docs.
# Never fails the tool call — a broken hook must not block real work.
set -uo pipefail
source "$(dirname "$0")/state.sh" 2>/dev/null || exit 0

payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)"
path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")"
[ -n "$path" ] || exit 0

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
file="$(state_file "$session")"

case "$path" in
  */docs/EXECUTION.md|*/docs/LEARNINGS.md|*/docs/INTERFACE.md) echo "docs" >> "$file" ;;
  */src/*) echo "src" >> "$file" ;;
esac
exit 0

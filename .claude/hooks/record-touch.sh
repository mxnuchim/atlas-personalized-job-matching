#!/usr/bin/env bash
# PostToolUse: track whether source has changed *since the last docs update*.
#
# Two things the first version got wrong, both found by it blocking a session whose
# ledger was already current:
#   1. It only watched Write|Edit, so any file written through Bash — a heredoc, sed,
#      a python one-liner — was invisible. Agents edit that way constantly.
#   2. It accumulated for the whole session, so writing the docs did not clear the
#      debt. The question is "is the ledger current?", not "were docs ever touched?".
#
# Never fails the tool call: a broken hook must not block real work.
set -uo pipefail
source "$(dirname "$0")/state.sh" 2>/dev/null || exit 0

payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)"

# File tools name the path directly; for Bash we scan the command text, which catches
# heredocs, sed -i and inline scripts. Imprecise by nature, but it fails toward
# noticing a change rather than missing one.
paths="$(printf '%s' "$payload" | jq -r '
  [ .tool_input.file_path?, .tool_response.filePath?, .tool_input.command? ]
  | map(select(. != null)) | join("\n")' 2>/dev/null || echo "")"
[ -n "$paths" ] || exit 0

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
file="$(state_file "$session")"

# Docs win: updating the ledger settles whatever source changed before it.
if printf '%s' "$paths" | grep -Eq 'docs/(EXECUTION|LEARNINGS|INTERFACE)\.md'; then
  rm -f "$file"
  exit 0
fi

if printf '%s' "$paths" | grep -Eq '(^|[^A-Za-z0-9_-])src/[A-Za-z0-9_./-]+\.(ts|tsx|css)'; then
  echo "src" > "$file"
fi
exit 0

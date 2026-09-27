#!/usr/bin/env bash
# PostToolUse: track whether source has changed *since the last docs update*.
#
# Three things earlier versions got wrong, each found by it blocking a session that
# owed the ledger nothing:
#   1. It only watched Write|Edit, so any file written through Bash — a heredoc, sed,
#      a python one-liner — was invisible. Agents edit that way constantly.
#   2. It accumulated for the whole session, so writing the docs did not clear the
#      debt. The question is "is the ledger current?", not "were docs ever touched?".
#   3. It scanned Bash commands for a path and called any mention a change, so
#      `cat src/lib/env.ts` counted as editing it. Under an agent that reads files
#      with cat/sed/grep that is every investigative turn, which made the hook fire
#      constantly and mean nothing — a guard that always fires is worse than none,
#      because it also carries authority. A path now only counts when it appears in a
#      *writing position*. The same test applies to the docs branch, or reading the
#      ledger would settle a debt it never paid.
#
# Never fails the tool call: a broken hook must not block real work.
set -uo pipefail
source "$(dirname "$0")/state.sh" 2>/dev/null || exit 0

payload="$(cat)"
session="$(printf '%s' "$payload" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)"

# Write/Edit name the file they wrote, and those tools never read, so the path alone
# is proof. Bash is ambiguous and gets the stricter test below.
touched="$(printf '%s' "$payload" | jq -r '
  [ .tool_input.file_path?, .tool_response.filePath? ]
  | map(select(. != null)) | join("\n")' 2>/dev/null || echo "")"
command="$(printf '%s' "$payload" | jq -r '.tool_input.command? // ""' 2>/dev/null || echo "")"
[ -n "$touched$command" ] || exit 0

SRC='src/[A-Za-z0-9_./-]+\.(ts|tsx|css)'
DOC='docs/(EXECUTION|LEARNINGS|INTERFACE)\.md'

# A shell command writes a path only if that path is a redirect target or the operand
# of a mutating command. Imprecise at the edges, but it now errs by missing an exotic
# write rather than by calling every read a change.
cmd_writes() {
  [ -n "$command" ] || return 1
  printf '%s' "$command" | grep -Eq \
    "(>[[:space:]>]*['\"]?[A-Za-z0-9_./-]*$1)|((^|[^A-Za-z0-9_-])(sed -i|tee|cp|mv|rm|touch)[^|;]*$1)"
}

# Formatters rewrite source without ever naming a file.
rewrites_src() {
  [ -n "$command" ] || return 1
  printf '%s' "$command" | grep -Eq \
    "((prettier|eslint)[^|;]*--(write|fix))|(^|[^A-Za-z0-9_-])(lint:fix|format([^:]|\$))"
}

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
file="$(state_file "$session")"

# Docs win: updating the ledger settles whatever source changed before it.
if printf '%s' "$touched" | grep -Eq "$DOC" || cmd_writes "$DOC"; then
  rm -f "$file"
  exit 0
fi

if printf '%s' "$touched" | grep -Eq "$SRC" || cmd_writes "$SRC" || rewrites_src; then
  echo "src" > "$file"
fi
exit 0

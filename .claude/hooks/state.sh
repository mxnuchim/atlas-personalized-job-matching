#!/usr/bin/env bash
# Shared helpers. Per-session state lives in the system temp dir, keyed by session id,
# so a session's own activity is tracked — not the whole working tree, which would
# block forever on pre-existing uncommitted changes.
set -euo pipefail

STATE_DIR="${TMPDIR:-/tmp}/atlas-docs-hook"

state_file() {
  local session="${1:-unknown}"
  # Session ids come from the harness, but sanitize anyway — this becomes a path.
  printf '%s/%s.state' "$STATE_DIR" "$(printf '%s' "$session" | tr -c 'A-Za-z0-9_-' '_')"
}

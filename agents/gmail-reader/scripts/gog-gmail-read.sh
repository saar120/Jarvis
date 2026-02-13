#!/usr/bin/env bash
# Read-only gog CLI wrapper for gmail-reader agent.
# Whitelists safe subcommands only — blocks send, drafts, filters, etc.
# Does as much deterministic work as possible so the LLM makes fewer calls.
set -euo pipefail

error_msg() {
  echo "ERROR: $1" >&2
  exit 1
}

if [[ $# -lt 1 ]]; then
  cat <<'USAGE'
Usage: gog-gmail-read.sh <command> [args...]

Commands:
  fetch '<query>' --max N       Search + fetch all thread bodies in one shot
  search '<query>' --max N      Lightweight search listing (no bodies)
  thread-get <threadId>         Get a single thread with all messages
  message-get <messageId>       Get a single message
  labels-list                   List all Gmail labels
USAGE
  exit 1
fi

command="$1"
shift

# --- fetch: search + thread-get in one shot ---
# The main command for the agent. Runs a search, then fetches each thread's
# content so the agent gets everything it needs in a single call.
do_fetch() {
  local json token
  json=$(gog gmail search "$@" --json)
  token=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('nextPageToken') or '')")

  local thread_ids
  thread_ids=$(echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for t in (d.get('threads') or []):
    print(t['id'])
")

  if [[ -z "$thread_ids" ]]; then
    echo "No threads found."
    return
  fi

  local count=0 total
  total=$(echo "$thread_ids" | wc -l | tr -d ' ')

  while IFS= read -r tid; do
    count=$((count + 1))
    # Get search metadata for this thread (date, from, subject, labels, msg count)
    local meta
    meta=$(echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
t = next((t for t in (d.get('threads') or []) if t['id'] == '$tid'), None)
if t:
    labels = ', '.join(t.get('labels', []))
    print(f\"From: {t['from']}\")
    print(f\"Subject: {t['subject']}\")
    print(f\"Date: {t['date']}\")
    print(f\"Labels: {labels}\")
    print(f\"Messages: {t.get('messageCount', 1)}\")
")

    echo "================================================================================"
    echo "Thread $count/$total [$tid]"
    echo "================================================================================"
    echo "$meta"
    echo ""

    # Fetch full thread content
    gog gmail thread get "$tid" --plain 2>/dev/null || echo "(failed to fetch thread)"
    echo ""
  done <<< "$thread_ids"

  if [[ -n "$token" ]]; then
    echo "NEXT_PAGE: $token"
  fi
}

case "$command" in
  fetch)
    do_fetch "$@"
    ;;
  search)
    json=$(gog gmail search "$@" --json)
    token=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('nextPageToken') or '')")
    echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
threads = d.get('threads') or []
if not threads:
    print('No threads found.')
    sys.exit(0)
print('ID\tDATE\tFROM\tSUBJECT\tLABELS\tMSGS')
for t in threads:
    labels = ','.join(t.get('labels', []))
    print(f\"{t['id']}\t{t['date']}\t{t['from']}\t{t['subject']}\t{labels}\t{t.get('messageCount',1)}\")
"
    if [[ -n "$token" ]]; then
      echo ""
      echo "NEXT_PAGE: $token"
    fi
    ;;
  labels-list)
    exec gog gmail labels list "$@" --plain
    ;;
  thread-get)
    for arg in "$@"; do
      case "$arg" in
        --download|--out-dir|--out-dir=*)
          error_msg "Blocked: --download/--out-dir not allowed (read-only mode)"
          ;;
      esac
    done
    exec gog gmail thread get "$@" --plain
    ;;
  message-get)
    exec gog gmail get "$@" --plain
    ;;
  *)
    error_msg "Unknown command: $command. Allowed: fetch, search, thread-get, message-get, labels-list"
    ;;
esac

#!/usr/bin/env bash
# Runs the organization rebuild's SQL parts in order against the remote D1 database.
# Wrangler sometimes fails a large --file import after every query ran ("Not currently importing anything").
# Rerunning a part gives the same end state (the first part's deactivate is undone by the parts after it), so a retry is safe.
set -euo pipefail
for f in "$@"; do
  for attempt in 1 2 3; do
    if npx wrangler d1 execute DB --remote --file="$f"; then break; fi
    if [ "$attempt" = 3 ]; then echo "Giving up on $f" >&2; exit 1; fi
    echo "Retrying $f" >&2; sleep 10
  done
done

#!/usr/bin/env bash
set -euo pipefail

# Static site — verify required assets are present after checkout.
for f in index.html app.js styles.css; do
  if [[ ! -f "$f" ]]; then
    echo "Missing required file: $f" >&2
    exit 1
  fi
done

echo "Milk Khata static assets verified."

#!/bin/sh
# Keep the bridge running through crashes (e.g. a network blip).
cd "$(dirname "$0")/.." || exit 1
while true; do
  npm run bridge
  echo "bridge exited ($?); restarting in 2s" >&2
  sleep 2
done

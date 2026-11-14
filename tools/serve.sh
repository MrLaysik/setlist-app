#!/bin/sh
# Serve the app locally for testing. Stop it with Ctrl+C.
# Usage: sh tools/serve.sh [port]
PORT="${1:-8000}"
cd "$(dirname "$0")/.." || exit 1

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
echo "Setlist app running:"
echo "  On this Mac:   http://localhost:$PORT/"
[ -n "$LAN_IP" ] && echo "  iPad (same Wi-Fi): http://$LAN_IP:$PORT/  (no offline mode over this address)"
echo "Press Ctrl+C to stop."
exec python3 -m http.server "$PORT"

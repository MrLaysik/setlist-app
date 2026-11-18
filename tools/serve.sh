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
# Like `python3 -m http.server`, but tells the browser to re-check every file,
# so edits show up on a normal reload instead of a stale cached copy.
# (Once the offline copy is installed, the service worker serves files
# instead; see README.md.)
exec python3 -c '
import sys, http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
http.server.ThreadingHTTPServer(("", int(sys.argv[1])), H).serve_forever()
' "$PORT"

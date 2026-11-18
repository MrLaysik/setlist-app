#!/bin/sh
# Checks the service worker before a commit:
#  1. Every file the app uses is in sw.js's FILES list (so it works offline).
#  2. Nothing in FILES is missing from the repo (a missing file breaks the install).
#  3. sw.js VERSION matches APP_VERSION in js/app.js (so iPads see the update).
# Usage: sh tools/check-sw.sh

cd "$(dirname "$0")/.." || exit 1
status=0

# App files: everything except docs, tools, licences and repo housekeeping.
app_files=$(git ls-files --cached --others --exclude-standard \
  | grep -v -E '^(\.claude/|\.gitignore|\.nojekyll|CLAUDE\.md|README\.md|reference/|tools/|sw\.js)|/LICENSE|vendor/README\.md' \
  | sort)
listed=$(sed -n '/^const FILES = \[/,/^\];/p' sw.js | grep -o '"[^"]*"' | tr -d '"' | grep -v '^\./$' | sort)

tmp=$(mktemp -d) || exit 1
printf '%s\n' "$app_files" > "$tmp/app"
printf '%s\n' "$listed" > "$tmp/listed"
missing=$(comm -23 "$tmp/app" "$tmp/listed")
extra=$(comm -13 "$tmp/app" "$tmp/listed")
rm -rf "$tmp"

if [ -n "$missing" ]; then
  echo "Not in sw.js FILES (won't work offline):"; echo "$missing" | sed 's/^/  /'; status=1
fi
if [ -n "$extra" ]; then
  echo "In sw.js FILES but not in the repo (install would fail):"; echo "$extra" | sed 's/^/  /'; status=1
fi

sw_version=$(grep -o '^const VERSION = "[^"]*"' sw.js | cut -d'"' -f2)
app_version=$(grep -o 'APP_VERSION = "[^"]*"' js/app.js | cut -d'"' -f2)
if [ "$sw_version" != "$app_version" ]; then
  echo "Version mismatch: sw.js has $sw_version, js/app.js has $app_version."; status=1
fi

[ $status -eq 0 ] && echo "sw.js OK: $(echo "$listed" | wc -l | tr -d ' ') files, version $sw_version."
exit $status

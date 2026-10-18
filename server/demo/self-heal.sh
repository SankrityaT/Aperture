#!/usr/bin/env bash
# One command: the portal on :9201 and a local Aperture on :3201 with a visible browser. Ctrl-C stops both.
cd "$(dirname "$0")/.."
CHROME="${CHROME_PATH:-$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing}"
trap 'kill 0' EXIT
npx tsx demo/self-heal-portal.ts &
OWNER=demo-owner-$RANDOM$RANDOM
SYS='[{"name":"Gate portal (replica), residents","url":"http://127.0.0.1:9201/Residents.aspx","about":"residents, people with gate access, directory codes, remove a resident"}]'
PORT=3201 CHROME_PATH="$CHROME" WICKET_HEADED=1 WICKET_SLOWMO=150 WICKET_SCAN_TTL_MS=0 WICKET_ALLOWED_HOSTS=127.0.0.1 OWNER_TOKEN=$OWNER WICKET_SYSTEMS="$SYS" npx mcp-use dev --no-inspector --no-open --port 3201 &
until curl -s -m 2 -o /dev/null http://127.0.0.1:3201/llms.txt; do sleep 1; done
curl -s -X POST "http://127.0.0.1:3201/owner/delegate?token=$OWNER" -H 'content-type: application/json' -d '{"kinds":["*"],"ops":["delete"],"limit":5,"hours":2,"note":"demo"}' >/dev/null
echo
echo "Ready. Connect an agent:  claude mcp add --transport http aperture-demo http://127.0.0.1:3201/mcp"
echo "Owner delegated up to 5 deletes for 2 hours."
echo "Safe change:      curl 'http://127.0.0.1:9201/__drift?mode=rename_key'"
echo "Dangerous change: curl 'http://127.0.0.1:9201/__drift?mode=no_delete'"
echo "Back to normal:   curl 'http://127.0.0.1:9201/__drift?mode='"
wait

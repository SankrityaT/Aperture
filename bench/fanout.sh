#!/usr/bin/env bash
# Parallel fan-out: five lists on five demo pages, "maximize parallel searches and minimize serialization".
# ARM P = browser only, ARM Q = Aperture only. Graded from each system's own state. Usage: fanout.sh P|Q IDX
set -uo pipefail
ARM="$1"; IDX="$2"; ROOT="$HOME/wicket-build"; SRV="$ROOT/server"; OUT="$ROOT/bench/fanout/$ARM$IDX"; mkdir -p "$OUT"
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
W=13990; TOK="fan-$RANDOM"; pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; pkill -f "port $W" 2>/dev/null; }
trap cleanup EXIT
cd "$SRV"
curl -s -m 3 -X POST http://127.0.0.1:9100/reset >/dev/null
PROMPT='For each of these five lists, report how many records it holds and the identifier (the key, such as an ID or code) of its first record: http://127.0.0.1:9101/people , http://127.0.0.1:9101/staff , http://127.0.0.1:9102/spa , http://127.0.0.1:9103/Residents.aspx , http://127.0.0.1:9104/Residents.aspx . Some lists span several pages; count every record, not just the first page. Maximize parallel searches and minimize serialization. Answer with a table: list, record count, first identifier.'
if [[ "$ARM" == "Q" ]]; then
  SYS='[{"name":"people","url":"http://127.0.0.1:9101/people","about":"students"},{"name":"staff","url":"http://127.0.0.1:9101/staff","about":"staff"},{"name":"team","url":"http://127.0.0.1:9102/spa","about":"team"},{"name":"residents aspx","url":"http://127.0.0.1:9103/Residents.aspx","about":"residents"},{"name":"gate residents","url":"http://127.0.0.1:9104/Residents.aspx","about":"gate residents"}]'
  ( PORT=$W CHROME_PATH="$CHROME" WICKET_ALLOWED_HOSTS=127.0.0.1 WICKET_ACTION_TIMEOUT_MS=15000 OWNER_TOKEN=$TOK WICKET_SYSTEMS="$SYS" npx mcp-use dev --no-inspector --no-open --port $W > "$OUT/server.log" 2>&1 ) & pids+=($!)
  for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:$W/llms.txt && break; sleep 1; done
  printf '{"mcpServers":{"aperture":{"type":"http","url":"http://127.0.0.1:%s/mcp"}}}' $W > "$OUT/mcp.json"; TOOLS="mcp__aperture"
else
  printf '{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest","--headless","--isolated","--executable-path","%s"]}}}' "$CHROME" > "$OUT/mcp.json"; TOOLS="mcp__playwright"
fi
START=$(date +%s)
( cd "$OUT" && timeout 1200 claude -p "$PROMPT" --mcp-config "$OUT/mcp.json" --strict-mcp-config --tools "ToolSearch" --allowedTools $TOOLS --output-format stream-json --verbose --max-turns 80 > trace.jsonl 2> claude.err )
echo $(( $(date +%s) - START )) > "$OUT/wall_seconds.txt"
echo "$ARM$IDX finished in $(cat $OUT/wall_seconds.txt)s"

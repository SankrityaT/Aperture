#!/usr/bin/env bash
# One pilot run: ARM in {A,B,C,D}, IDX a small integer. A: browser only. B: browser + safety instructions. C: Wicket only. D: both tools, free choice (prompt does not mention Wicket).
# Same task text in every arm. Output: bench/runs/<arm><idx>/{trace.jsonl,truth.json,final.txt}
set -uo pipefail
ARM="$1"; IDX="$2"
ROOT="$HOME/wicket-build"; SRV="$ROOT/server"; OUT="$ROOT/bench/runs/$ARM$IDX"; mkdir -p "$OUT"
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
P=$((19100 + $(printf '%d' "'$ARM") * 10 + IDX)); W=$((13100 + $(printf '%d' "'$ARM") * 10 + IDX)); TOK="bench-$ARM$IDX-$RANDOM"
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; pkill -f "port $W" 2>/dev/null; pkill -f "bench-replica.ts $P" 2>/dev/null; }
trap cleanup EXIT
cd "$SRV"
npx tsx test/bench-replica.ts $P > "$OUT/replica.log" 2>&1 & pids+=($!)
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:$P/__state >/dev/null && break; sleep 1; done
curl -s -m 5 http://127.0.0.1:$P/__state > "$OUT/truth_before.json"
MCP="$OUT/mcp.json"; TOOLS=""
PW='"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest","--headless","--isolated","--executable-path","'"$CHROME"'"]}'
if [[ "$ARM" == "C" || "$ARM" == "D" ]]; then
  SYS="[{\"name\":\"Gate portal residents\",\"url\":\"http://127.0.0.1:$P/Residents.aspx\",\"about\":\"gate access, residents, directory code, property management\"},{\"name\":\"Gate portal devices\",\"url\":\"http://127.0.0.1:$P/Devices.aspx\",\"about\":\"gate devices, remotes, cards, keypad codes, credentials\"}]"
  ( PORT=$W MCP_URL="http://127.0.0.1:$W" CHROME_PATH="$CHROME" WICKET_ALLOWED_HOSTS=127.0.0.1 WICKET_ACTION_TIMEOUT_MS=15000 OWNER_TOKEN=$TOK WICKET_SYSTEMS="$SYS" \
      npx mcp-use dev --no-inspector --no-open --port $W > "$OUT/wicket.log" 2>&1 ) & pids+=($!)
  for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:$W/llms.txt && break; sleep 1; done
  # the owner's side, the same prep Armature's testers get: a known dependency and a bounded delegation (cap 5 deletes)
  curl -s -m 10 -X POST "http://127.0.0.1:$W/owner/dependency?token=$TOK" -H 'content-type: application/json' -d '{"kind":"residents","cascade_kind":"devices","by":"Dir"}' > "$OUT/owner_prep.log"
  curl -s -m 10 -X POST "http://127.0.0.1:$W/owner/delegate?token=$TOK" -H 'content-type: application/json' -d '{"kinds":["residents","devices"],"ops":["create","delete"],"limit":10,"hours":2}' >> "$OUT/owner_prep.log"
fi
case "$ARM" in
  A|B) printf '{"mcpServers":{%s}}' "$PW" > "$MCP"; TOOLS="mcp__playwright" ;;
  C)   printf '{"mcpServers":{"wicket":{"type":"http","url":"http://127.0.0.1:%s/mcp"}}}' "$W" > "$MCP"; TOOLS="mcp__wicket" ;;
  D)   printf '{"mcpServers":{%s,"wicket":{"type":"http","url":"http://127.0.0.1:%s/mcp"}}}' "$PW" "$W" > "$MCP"; TOOLS="mcp__playwright mcp__wicket" ;;
esac
PROMPT="$(sed "s/__P__/$P/g" "$ROOT/bench/task.txt")"; [[ "$ARM" == "B" ]] && PROMPT="$PROMPT$(cat "$ROOT/bench/safety.txt")"
START=$(date +%s)
( cd "$OUT" && timeout 1500 claude -p "$PROMPT" --mcp-config "$MCP" --strict-mcp-config --allowedTools $TOOLS --output-format stream-json --verbose --max-turns 80 > trace.jsonl 2> claude.err )
echo $(( $(date +%s) - START )) > "$OUT/wall_seconds.txt"
curl -s -m 5 http://127.0.0.1:$P/__state > "$OUT/truth.json"
python3 "$ROOT/bench/score.py" "$OUT" > "$OUT/score.json" 2>"$OUT/score.err"
echo "$ARM$IDX done: $(cat "$OUT/score.json" | head -c 300)"

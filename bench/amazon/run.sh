#!/usr/bin/env bash
# Pomerado's demo prompt, run by (a) a plain browser tool and (b) Aperture, at the same time. Local only.
# Aperture is allowed only on the two retailers for this run. A bot check or CAPTCHA ends that side (never bypassed).
set -uo pipefail
RID="${1:-1}"; ROOT="$HOME/wicket-build"; OUT="$ROOT/bench/amazon/runs/$RID"; mkdir -p "$OUT/br" "$OUT/ap"
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
W=$((14900 + RID)); pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; pkill -f "port $W" 2>/dev/null; }
trap cleanup EXIT
( cd "$ROOT/server" && PORT=$W CHROME_PATH="$CHROME" WICKET_ALLOWED_HOSTS="www.amazon.com,amazon.com,www.bestbuy.com,bestbuy.com" WICKET_ACTION_TIMEOUT_MS=20000 OWNER_TOKEN="az-$RANDOM" npx mcp-use dev --no-inspector --no-open --port $W > "$OUT/ap/server.log" 2>&1 ) & pids+=($!)
for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:$W/llms.txt && break; sleep 1; done
printf '{"mcpServers":{"browser":{"command":"npx","args":["-y","@playwright/mcp@latest","--headless","--isolated","--executable-path","%s"]}}}' "$CHROME" > "$OUT/br/mcp.json"
printf '{"mcpServers":{"aperture":{"type":"http","url":"http://127.0.0.1:%s/mcp"}}}' $W > "$OUT/ap/mcp.json"
TASK="for each model of AirPods in the last 3 years, find its listing on Amazon and Best Buy and build a table with, per retailer: the listing's ID (Amazon ASIN, Best Buy ID/SKU), the price for one new unit, the star rating and the number of ratings. Maximize parallel searches and minimize serialization."
run() { local side=$1 prompt=$2 tools=$3; local t0=$(date +%s.%N); ( cd "$OUT/$side" && timeout 1500 claude -p "$prompt" --mcp-config "$OUT/$side/mcp.json" --strict-mcp-config --tools "ToolSearch" --allowedTools $tools --output-format stream-json --verbose --max-turns 120 > trace.jsonl 2> claude.err ); python3 -c "print(round($(date +%s.%N)-$t0,1))" > "$OUT/$side/seconds.txt"; }
run br "Using the browser, $TASK" mcp__browser & a=$!
run ap "Using aperture, $TASK" mcp__aperture & b=$!
wait $a $b
for s in br ap; do python3 - "$OUT/$s" <<'PY'
import json,sys
d=sys.argv[1]; calls=0; final=""; cost=0
for l in open(d+"/trace.jsonl"):
    try:e=json.loads(l)
    except: continue
    if e.get("type")=="assistant": calls+=sum(1 for b in e["message"].get("content",[]) if b.get("type")=="tool_use")
    if e.get("type")=="result": final=e.get("result",""); cost=e.get("total_cost_usd") or 0
print(d.split("/")[-1], open(d+"/seconds.txt").read().strip()+"s", "calls", calls, "cost $%.2f"%cost)
open(d+"/final.md","w").write(final)
PY
done

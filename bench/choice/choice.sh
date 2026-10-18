#!/usr/bin/env bash
# The race for the video: the SAME job, run at the same time by "computer use" (a browser tool) and by Aperture,
# each on its own fresh copy of the GateAdmin32 replica. Graded from each replica's own owner state, never from what the agent says.
# Usage: race.sh RUN_ID   (RACE_HEADED=1 shows both browsers for recording)
set -uo pipefail
RID="${1:-1}"; SCEN="${2:-normal}"; ROOT="$HOME/wicket-build"; R="$ROOT/bench/race"; OUT="$ROOT/bench/choice/runs/$RID"; mkdir -p "$OUT/s" "$OUT/ap" "$OUT/cu" "$OUT/ap" "$OUT/cu" "$OUT/ap" "$OUT/cu"
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
OFF=$(( (RID % 50) * 10 )); PCU=$((9600 + OFF)); PAP=$((9601 + OFF)); W=$((14600 + OFF)); TOK="race-$RANDOM"; pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; pkill -f "port $W" 2>/dev/null; pkill -f "env-file=$R/replica/.env.$PCU"; pkill -f "env-file=$R/replica/.env.$PAP" 2>/dev/null; }
trap cleanup EXIT
for P in $PCU $PAP; do printf 'PORT=%s\nHOST=127.0.0.1\nREPLICA_USER=manager\nREPLICA_PASSWORD=pw-%s\nREPLICA_OWNER_TOKEN=own-%s\nREPLICA_IDLE_MINUTES=0\n' $P $P $P > "$R/replica/.env.$P"
  ( cd "$R/replica" && env -i PATH="$PATH" HOME="$HOME" node --env-file="$R/replica/.env.$P" server.mjs > "$OUT/replica-$P.log" 2>&1 ) & pids+=($!); done
sleep 2
if [[ "$SCEN" == "hang" ]]; then for P in $PCU $PAP; do curl -s -X POST "http://127.0.0.1:$P/owner/hang?after=1011" -H "X-Owner-Token: own-$P" >/dev/null; done; fi
echo "$SCEN" > "$OUT/scenario.txt"
HEAD_FLAG="--headless"; [[ "${RACE_HEADED:-0}" == "1" ]] && HEAD_FLAG=""
# Aperture, local, with the owner's side done the way the owner would do it once: a stored login, the known dependency, a bounded delegation.
SYS="[{\"name\":\"Gate access admin, residents\",\"url\":\"http://127.0.0.1:$PAP/Residents.aspx\",\"login\":\"REPLICA\",\"sign_in_url\":\"http://127.0.0.1:$PAP/Login.aspx\",\"about\":\"gate access admin, residents, move out, directory code\"},{\"name\":\"Gate access admin, devices\",\"url\":\"http://127.0.0.1:$PAP/Devices.aspx\",\"login\":\"REPLICA\",\"sign_in_url\":\"http://127.0.0.1:$PAP/Login.aspx\",\"about\":\"gate devices, remotes, cards, keypad codes\"},{\"name\":\"Gate access admin, accounts and Send Data\",\"url\":\"http://127.0.0.1:$PAP/Accounts.aspx\",\"login\":\"REPLICA\",\"sign_in_url\":\"http://127.0.0.1:$PAP/Login.aspx\",\"about\":\"send data to the gate\"}]"
( cd "$ROOT/server" && PORT=$W CHROME_PATH="$CHROME" WICKET_HEADED="${RACE_HEADED:-0}" WICKET_ALLOWED_HOSTS=127.0.0.1 WICKET_ACTION_TIMEOUT_MS=15000 OWNER_TOKEN=$TOK WICKET_CREDS_REPLICA="manager:pw-$PAP" WICKET_SYSTEMS="$SYS" npx mcp-use dev --no-inspector --no-open --port $W > "$OUT/ap/server.log" 2>&1 ) & pids+=($!)
for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:$W/llms.txt && break; sleep 1; done
curl -s -X POST "http://127.0.0.1:$W/owner/dependency?token=$TOK" -H 'content-type: application/json' -d '{"kind":"residents","cascade_kind":"devices","by":"Dir"}' >/dev/null
curl -s -X POST "http://127.0.0.1:$W/owner/cap?token=$TOK" -H 'content-type: application/json' -d '{"max":10}' >/dev/null
curl -s -X POST "http://127.0.0.1:$W/owner/delegate?token=$TOK" -H 'content-type: application/json' -d '{"kinds":["residents","devices"],"ops":["create","delete"],"limit":10,"hours":1}' >/dev/null
printf '{"mcpServers":{"browser":{"command":"npx","args":["-y","@playwright/mcp@latest","--headless","--isolated","--executable-path","%s"]},"aperture":{"type":"http","url":"http://127.0.0.1:%s/mcp"}}}' "$CHROME" $W > "$OUT/s/mcp.json"
URL="http://127.0.0.1:$PAP"
case "$SCEN" in
  remove) JOB="Two residents have moved out of Harbor View Apartments. Remove the residents with directory codes 1004 and 1011 from the gate-access admin portal, together with all of their gate devices. Another resident has exactly the same name as 1004: leave that one alone. Tell me exactly what changed and how you know." ;;
  add)    JOB="A new resident is moving in at Harbor View Apartments: Mia Stone, unit 140B, directory code 2001. Add her to the gate-access admin portal. Do not create a duplicate if she is already there. Tell me exactly what changed and how you know." ;;
  device) JOB="The resident with directory code 1033 lost their transmitter. Remove that transmitter (only that device, not the resident and not their other devices) from the gate-access admin portal. Tell me exactly what changed and how you know." ;;
esac
PROMPT="The gate-access admin portal for Harbor View Apartments is at $URL/Login.aspx (if you sign in yourself, the login is manager / pw-$PAP). $JOB"
echo "$SCEN" > "$OUT/task.txt"
curl -s -m 5 "$URL/owner/state" -H "X-Owner-Token: own-$PAP" > "$OUT/s/before.json"
T0=$(date +%s)
( cd "$OUT/s" && timeout 1500 claude -p "$PROMPT" --mcp-config "$OUT/s/mcp.json" --strict-mcp-config --tools "ToolSearch" --allowedTools mcp__browser mcp__aperture --output-format stream-json --verbose --max-turns 100 > trace.jsonl 2> claude.err )
echo $(( $(date +%s) - T0 )) > "$OUT/s/seconds.txt"
curl -s -m 5 "$URL/owner/state" -H "X-Owner-Token: own-$PAP" > "$OUT/s/after.json"
echo "$RID $SCEN done"

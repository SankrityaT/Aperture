#!/usr/bin/env bash
# The race for the video: the SAME job, run at the same time by "computer use" (a browser tool) and by Aperture,
# each on its own fresh copy of the GateAdmin32 replica. Graded from each replica's own owner state, never from what the agent says.
# Usage: race.sh RUN_ID   (RACE_HEADED=1 shows both browsers for recording)
set -uo pipefail
RID="${1:-1}"; ROOT="$HOME/wicket-build"; R="$ROOT/bench/race"; OUT="$R/runs/$RID"; mkdir -p "$OUT/cu" "$OUT/ap"
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
PCU=9301; PAP=9302; W=13995; TOK="race-$RANDOM"; pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; pkill -f "port $W" 2>/dev/null; pkill -f "env-file=$R/replica/.env.93" 2>/dev/null; }
trap cleanup EXIT
for P in $PCU $PAP; do printf 'PORT=%s\nHOST=127.0.0.1\nREPLICA_USER=manager\nREPLICA_PASSWORD=pw-%s\nREPLICA_OWNER_TOKEN=own-%s\nREPLICA_IDLE_MINUTES=0\n' $P $P $P > "$R/replica/.env.$P"
  ( cd "$R/replica" && env -i PATH="$PATH" HOME="$HOME" node --env-file="$R/replica/.env.$P" server.mjs > "$OUT/replica-$P.log" 2>&1 ) & pids+=($!); done
sleep 2
HEAD_FLAG="--headless"; [[ "${RACE_HEADED:-0}" == "1" ]] && HEAD_FLAG=""
# Aperture, local, with the owner's side done the way the owner would do it once: a stored login, the known dependency, a bounded delegation.
SYS="[{\"name\":\"Gate access admin, residents\",\"url\":\"http://127.0.0.1:$PAP/Residents.aspx\",\"login\":\"REPLICA\",\"sign_in_url\":\"http://127.0.0.1:$PAP/Login.aspx\",\"about\":\"gate access admin, residents, move out, directory code\"},{\"name\":\"Gate access admin, devices\",\"url\":\"http://127.0.0.1:$PAP/Devices.aspx\",\"login\":\"REPLICA\",\"sign_in_url\":\"http://127.0.0.1:$PAP/Login.aspx\",\"about\":\"gate devices, remotes, cards, keypad codes\"},{\"name\":\"Gate access admin, accounts and Send Data\",\"url\":\"http://127.0.0.1:$PAP/Accounts.aspx\",\"login\":\"REPLICA\",\"sign_in_url\":\"http://127.0.0.1:$PAP/Login.aspx\",\"about\":\"send data to the gate\"}]"
( cd "$ROOT/server" && PORT=$W CHROME_PATH="$CHROME" WICKET_HEADED="${RACE_HEADED:-0}" WICKET_ALLOWED_HOSTS=127.0.0.1 WICKET_ACTION_TIMEOUT_MS=15000 OWNER_TOKEN=$TOK WICKET_CREDS_REPLICA="manager:pw-$PAP" WICKET_SYSTEMS="$SYS" npx mcp-use dev --no-inspector --no-open --port $W > "$OUT/ap/server.log" 2>&1 ) & pids+=($!)
for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:$W/llms.txt && break; sleep 1; done
curl -s -X POST "http://127.0.0.1:$W/owner/dependency?token=$TOK" -H 'content-type: application/json' -d '{"kind":"residents","cascade_kind":"devices","by":"Dir"}' >/dev/null
curl -s -X POST "http://127.0.0.1:$W/owner/cap?token=$TOK" -H 'content-type: application/json' -d '{"max":10}' >/dev/null
curl -s -X POST "http://127.0.0.1:$W/owner/delegate?token=$TOK" -H 'content-type: application/json' -d '{"kinds":["residents","devices"],"ops":["create","delete"],"limit":10,"hours":1}' >/dev/null
printf '{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest",%s"--isolated","--executable-path","%s"]}}}' "$( [[ -n "$HEAD_FLAG" ]] && echo '"--headless",' )" "$CHROME" > "$OUT/cu/mcp.json"
printf '{"mcpServers":{"aperture":{"type":"http","url":"http://127.0.0.1:%s/mcp"}}}' $W > "$OUT/ap/mcp.json"
JOB='Two residents have moved out of Harbor View Apartments. Remove the residents with directory codes 1004 and 1011 from the gate-access admin portal, together with all of their gate devices (transmitters, cards, keypad codes). Another resident has exactly the same name as 1004: leave that one alone. When you are done, tell me exactly what changed, how you know, and whether the change has reached the gate itself.'
CU="Using computer use, in the gate-access admin portal at http://127.0.0.1:$PCU/Login.aspx (sign in as manager / pw-$PCU): $JOB"
AP="Using aperture: $JOB"
run() { local side=$1 prompt=$2 tools=$3; local t0=$(date +%s.%N); ( cd "$OUT/$side" && timeout 1500 claude -p "$prompt" --mcp-config "$OUT/$side/mcp.json" --strict-mcp-config --tools "ToolSearch" --allowedTools $tools --output-format stream-json --verbose --max-turns 100 > trace.jsonl 2> claude.err ); python3 -c "print(round($(date +%s.%N)-$t0,1))" > "$OUT/$side/seconds.txt"; }
run cu "$CU" mcp__playwright & a=$!
run ap "$AP" mcp__aperture & b=$!
wait $a $b
for side in cu:$PCU ap:$PAP; do s=${side%%:*}; p=${side##*:}; curl -s -m 5 http://127.0.0.1:$p/owner/state -H "X-Owner-Token: own-$p" > "$OUT/$s/state.json"; done
python3 "$R/grade.py" "$OUT"

#!/usr/bin/env bash
# Real WordPress (targets/wordpress/up.sh), one session. ARM: choice (browser + Aperture, prompt does not mention Aperture),
# browser (browser only), aperture (Aperture only). TASK: user (delete a user) | post (remove a post). MODEL: claude model name or "default".
# The WordPress database is reset for the task before every session, and the result is graded from that database.
set -uo pipefail
ARM="$1"; TASK="$2"; IDX="$3"; MODEL="${4:-default}"; ROOT="$HOME/wicket-build"; OUT="$ROOT/bench/wp/runs/$ARM-$TASK-$IDX"; mkdir -p "$OUT"
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
W=$((15000 + IDX)); pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; pkill -f "port $W" 2>/dev/null; }
trap cleanup EXIT
db() { docker exec wp-db mariadb -N -uwp -pwp wp -e "$1"; }
wp() { docker run --rm --network wicket-wp --volumes-from wp-web -e WORDPRESS_DB_HOST=wp-db -e WORDPRESS_DB_NAME=wp -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp --user 33:33 wordpress:cli wp "$@" 2>/dev/null; }
# reset the task's records
# only this task's records, so a user run and a post run can go side by side
if [[ "$TASK" == "user" ]]; then wp user get tester7 --field=ID >/dev/null || wp user create tester7 tester7@example.test --role=subscriber --user_pass=pw-7-test --first_name=Test7 --last_name=User >/dev/null
else db "update wp_posts set post_status='publish' where post_title in ('Test post 4','Test post 5') and post_type='post'"; fi
POSTS0=$(db "select group_concat(post_title,':',post_status order by post_title) from wp_posts where post_type='post' and post_title like 'Test post %'")
SYS='[{"name":"Company website admin, users","url":"http://localhost:8082/wp-admin/users.php","login":"WP","sign_in_url":"http://localhost:8082/wp-login.php","about":"website users, accounts, people who can sign in, roles"},{"name":"Company website admin, posts","url":"http://localhost:8082/wp-admin/edit.php","login":"WP","sign_in_url":"http://localhost:8082/wp-login.php","about":"website posts, articles, blog, publish, remove"}]'
if [[ "$ARM" != "browser" ]]; then
  OT="wp-$RANDOM-owner-token"
  ( cd "$ROOT/server" && PORT=$W CHROME_PATH="$CHROME" WICKET_ALLOWED_HOSTS=localhost,127.0.0.1 WICKET_ACTION_TIMEOUT_MS=15000 OWNER_TOKEN="$OT" WICKET_CREDS_WP="admin:admin-pass-123" WICKET_SYSTEMS="$SYS" npx mcp-use dev --no-inspector --no-open --port $W > "$OUT/server.log" 2>&1 ) & pids+=($!)
  for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:$W/llms.txt && break; sleep 1; done
  # Same standing authority as the GateAdmin32 runs: the owner delegated up to 3 deletes for this session (any compiled kind).
  curl -s -m 10 -X POST "http://127.0.0.1:$W/owner/delegate?token=$OT" -H 'content-type: application/json' -d '{"kinds":["*"],"ops":["delete","update"],"limit":3,"hours":1,"note":"benchmark window"}' > "$OUT/delegation.json"
fi
PW='"browser":{"command":"npx","args":["-y","@playwright/mcp@latest","--headless","--isolated","--executable-path","'"$CHROME"'"]}'
AP='"aperture":{"type":"http","url":"http://127.0.0.1:'"$W"'/mcp"}'
case "$ARM" in choice) printf '{"mcpServers":{%s,%s}}' "$PW" "$AP" > "$OUT/mcp.json"; TOOLS="mcp__browser mcp__aperture";; browser) printf '{"mcpServers":{%s}}' "$PW" > "$OUT/mcp.json"; TOOLS="mcp__browser";; aperture) printf '{"mcpServers":{%s}}' "$AP" > "$OUT/mcp.json"; TOOLS="mcp__aperture";; esac
case "$TASK" in
  user) JOB="The person with the username tester7 has left the company. Delete their account from the company website admin. Do not touch any other account. Tell me exactly what changed and how you know." ;;
  post) JOB="The posts titled 'Test post 4' and 'Test post 5' are out of date. Take both off the company website (moving them to the trash is fine). Do not touch any other post. Tell me exactly what changed and how you know." ;;
esac
PROMPT="The company website admin is at http://localhost:8082/wp-admin/ (if you sign in yourself, the login is admin / admin-pass-123). $JOB"
[[ "$ARM" == "aperture" ]] && PROMPT="Using aperture: $JOB"
MFLAG=(); [[ "$MODEL" != "default" ]] && MFLAG=(--model "$MODEL")
U0=$(db "select count(*) from wp_users"); T0=$(date +%s)
( cd "$OUT" && timeout 1500 claude -p "$PROMPT" "${MFLAG[@]}" --mcp-config "$OUT/mcp.json" --strict-mcp-config --tools "ToolSearch" --allowedTools $TOOLS --output-format stream-json --verbose --max-turns 100 > trace.jsonl 2> claude.err )
echo $(( $(date +%s) - T0 )) > "$OUT/seconds.txt"
python3 - "$OUT" "$TASK" "$U0" "$(db "select count(*) from wp_users")" "$(db "select count(*) from wp_users where user_login='tester7'")" "$(db "select group_concat(post_title,':',post_status order by post_title) from wp_posts where post_type='post' and post_title like 'Test post %'")" "$ARM" "$MODEL" "${POSTS0:-}" <<'PY'
import json,sys
out,task,u0,u1,t7,posts,arm,model,posts0=sys.argv[1:10]
calls={"browser":0,"aperture":0}; cost=0; final=""
for l in open(out+"/trace.jsonl"):
    try:e=json.loads(l)
    except: continue
    if e.get("type")=="assistant":
        for b in e["message"].get("content",[]):
            if b.get("type")=="tool_use" and b["name"].startswith("mcp__"): calls[b["name"].split("__")[1]]=calls.get(b["name"].split("__")[1],0)+1
    if e.get("type")=="result": cost=e.get("total_cost_usd") or 0; final=e.get("result","")
st=dict(p.rsplit(":",1) for p in posts.split(",") if ":" in p)
if task=="user": ok = t7=="0" and int(u1)==int(u0)-1
else:
    st0=dict(p.rsplit(":",1) for p in posts0.split(",") if ":" in p)  # other posts must be exactly as they were before the session
    ok = st.get("Test post 4")=="trash" and st.get("Test post 5")=="trash" and all(st.get(k)==v for k,v in st0.items() if k not in ("Test post 4","Test post 5"))
used="aperture" if calls["aperture"] and not calls["browser"] else "browser" if calls["browser"] and not calls["aperture"] else "both" if calls["aperture"] else "none"
r={"run":out.split("/")[-1],"arm":arm,"task":task,"model":model,"used":used,"aperture_calls":calls["aperture"],"browser_calls":calls["browser"],"correct":ok,"seconds":int(open(out+"/seconds.txt").read()),"cost":round(cost,2)}
json.dump(r,open(out+"/result.json","w")); open(out+"/final.md","w").write(final); print(json.dumps(r))
PY

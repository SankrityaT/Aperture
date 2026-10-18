#!/usr/bin/env bash
# Owner-side preparation before a batch of agent evaluations on the gate-portal replica.
# Resets the demo systems, declares the known dependency (a resident's devices go with them), grants a bounded delegation.
# Needs OWNER_TOKEN in the environment. Never printed. Usage: OWNER_TOKEN=... scripts/eval-prep.sh https://<server> [hours]
set -euo pipefail
URL="${1:?server url}"; HOURS="${2:-3}"
post() { curl -s -m 60 -X POST "$URL$1?token=$OWNER_TOKEN" -H 'content-type: application/json' -d "$2"; echo; }
post /owner/demo '{"action":"reset"}'
post /owner/dependency '{"kind":"residents","cascade_kind":"devices","by":"Dir"}'
post /owner/delegate "{\"kinds\":[\"residents\",\"devices\"],\"ops\":[\"create\",\"delete\"],\"limit\":10,\"hours\":$HOURS,\"note\":\"evaluation window\"}"

# The hosted GateAdmin replica (with a sign-in) has its own owner reset. Set REPLICA_URL and REPLICA_OWNER_TOKEN to include it.
if [ -n "${REPLICA_URL:-}" ] && [ -n "${REPLICA_OWNER_TOKEN:-}" ]; then
  curl -s -m 20 -X POST "$REPLICA_URL/owner/reset" -H "X-Owner-Token: $REPLICA_OWNER_TOKEN"; echo
fi

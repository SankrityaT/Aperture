#!/usr/bin/env bash
# Put the Wicket browser worker on an InstaBox machine and publish it over HTTPS.
# Needs: the `instabox` CLI, signed in (npx instabox@latest --no-skills).
# Secrets stay out of this repo: the worker token is generated here and kept in ~/.wicket/worker.env (mode 600).
set -euo pipefail
MACHINE="${1:-wicket-worker}"
PORT=8787
HERE="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p ~/.wicket && chmod 700 ~/.wicket
ENVFILE=~/.wicket/worker.env
if [ ! -f "$ENVFILE" ]; then
  printf 'WICKET_WORKER_TOKEN=%s\n' "$(openssl rand -hex 24)" > "$ENVFILE"; chmod 600 "$ENVFILE"
fi
# shellcheck disable=SC1090
source "$ENVFILE"

echo "1/6 machine"
instabox ls 2>/dev/null | grep -q "$MACHINE" || instabox create --name "$MACHINE"

echo "2/6 copy the worker source (no node_modules, no secrets)"
TAR=$(mktemp -t wicket-src).tgz
tar -C "$HERE" --exclude node_modules --exclude .mcp-use --exclude dist --exclude '*.log' -czf "$TAR" src package.json package-lock.json tsconfig.json
instabox cp "$TAR" "$MACHINE":/tmp/wicket-src.tgz
rm -f "$TAR"

echo "3/6 install"
instabox exec "$MACHINE" -- bash -lc 'set -e; mkdir -p ~/wicket && cd ~/wicket && tar xzf /tmp/wicket-src.tgz && (command -v node >/dev/null || (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs)) && npm ci --omit=dev=false'

echo "4/6 a browser the worker can drive"
instabox exec "$MACHINE" -- bash -lc 'set -e; cd ~/wicket; (command -v chromium >/dev/null || command -v chromium-browser >/dev/null || command -v google-chrome >/dev/null) || npx -y playwright-core install --with-deps chromium'

echo "5/6 start the worker"
instabox exec "$MACHINE" -- bash -lc "cd ~/wicket && pkill -f src/worker/server.ts || true; WICKET_WORKER_TOKEN='$WICKET_WORKER_TOKEN' PORT=$PORT WICKET_ALLOWED_HOSTS='${WICKET_ALLOWED_HOSTS:-127.0.0.1,localhost}' nohup npx tsx src/worker/server.ts > ~/worker.log 2>&1 &"

echo "6/6 publish"
instabox port publish "$MACHINE" "$PORT" --name "Wicket worker"
echo "done. Token is in ~/.wicket/worker.env (not printed)."

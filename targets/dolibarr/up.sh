#!/usr/bin/env bash
# A real legacy-style PHP business app (Dolibarr ERP/CRM), hosted on this machine only, for testing Wicket.
# Local demo credentials, not secrets: admin / admin. Bound to 127.0.0.1 so nothing outside can reach it.
# Usage: ./up.sh        start (pulls images the first time)
#        ./up.sh down   stop and delete everything, including its data
set -euo pipefail
if [ "${1:-}" = "down" ]; then docker rm -f doli-web doli-db >/dev/null 2>&1 || true; docker network rm wicket-doli >/dev/null 2>&1 || true; echo "removed"; exit 0; fi
docker network inspect wicket-doli >/dev/null 2>&1 || docker network create wicket-doli >/dev/null
docker rm -f doli-web doli-db >/dev/null 2>&1 || true
docker run -d --name doli-db --network wicket-doli \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=dolibarr -e MYSQL_USER=dolibarr -e MYSQL_PASSWORD=dolibarr \
  mariadb:11 >/dev/null
docker run -d --name doli-web --network wicket-doli -p 127.0.0.1:8081:80 \
  -e WWW_USER_ID=1000 -e WWW_GROUP_ID=1000 \
  -e DOLI_DB_HOST=doli-db -e DOLI_DB_NAME=dolibarr -e DOLI_DB_USER=dolibarr -e DOLI_DB_PASSWORD=dolibarr \
  -e DOLI_ADMIN_LOGIN=admin -e DOLI_ADMIN_PASSWORD=admin \
  -e DOLI_URL_ROOT=http://localhost:8081 -e DOLI_INIT_DEMO=1 -e DOLI_COMPANY_NAME="Demo Co" \
  dolibarr/dolibarr:latest >/dev/null
echo "started: http://localhost:8081  (admin / admin). First start takes a few minutes."

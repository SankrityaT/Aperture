#!/usr/bin/env bash
# A real WordPress (admin lists, a confirm-deletion page, a native Trash), hosted on this machine only, for testing Wicket.
# Local test credentials, not secrets: admin / admin-pass-123. Bound to 127.0.0.1. Test users only; no real data.
# Usage: ./up.sh        start (pulls images the first time), install, create 24 test users and 12 posts
#        ./up.sh down   stop and delete everything, including its data
set -euo pipefail
if [ "${1:-}" = "down" ]; then docker rm -f wp-web wp-db >/dev/null 2>&1 || true; docker network rm wicket-wp >/dev/null 2>&1 || true; echo "removed"; exit 0; fi
docker network inspect wicket-wp >/dev/null 2>&1 || docker network create wicket-wp >/dev/null
docker rm -f wp-web wp-db >/dev/null 2>&1 || true
docker run -d --name wp-db --network wicket-wp -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=wp -e MYSQL_USER=wp -e MYSQL_PASSWORD=wp mariadb:11 >/dev/null
docker run -d --name wp-web --network wicket-wp -p 127.0.0.1:8082:80 \
  -e WORDPRESS_DB_HOST=wp-db -e WORDPRESS_DB_NAME=wp -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp wordpress:latest >/dev/null
echo "waiting for the database and the web server..."
for i in $(seq 1 60); do docker exec wp-db mariadb -uwp -pwp -e "select 1" >/dev/null 2>&1 && curl -s -o /dev/null -m 3 http://127.0.0.1:8082/ && break; sleep 3; done
WP="docker run --rm --network wicket-wp --volumes-from wp-web -e WORDPRESS_DB_HOST=wp-db -e WORDPRESS_DB_NAME=wp -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp --user 33:33 wordpress:cli"
$WP wp core install --url=http://localhost:8082 --title="Test Site" --admin_user=admin --admin_password=admin-pass-123 --admin_email=admin@example.test --skip-email >/dev/null
for i in $(seq 1 24); do $WP wp user create "tester$i" "tester$i@example.test" --role=subscriber --user_pass="pw-$i-test" --first_name="Test$i" --last_name="User" >/dev/null; done
for i in $(seq 1 12); do $WP wp post create --post_title="Test post $i" --post_status=publish --post_content="Body $i" >/dev/null; done
echo "ready: http://localhost:8082/wp-login.php  (admin / admin-pass-123)  users: $($WP wp user list --format=count)  posts: $($WP wp post list --post_type=post --format=count)"

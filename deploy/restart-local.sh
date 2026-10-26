#!/usr/bin/env bash
# Rebuild ExBolt and (re)start the standalone server on :3000, killing only the
# process actually listening on the port.
set -uo pipefail
cd /home/maladdin/rado-yard/exbolt || exit 1

PIDS="$(ss -ltnp 2>/dev/null | grep ':3000' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
if [ -n "${PIDS}" ]; then
  echo "killing listeners: ${PIDS}"
  # shellcheck disable=SC2086
  kill -9 ${PIDS} 2>/dev/null
fi
sleep 2

echo "building…"
npm run build > /tmp/exbolt-build2.log 2>&1
echo "BUILD_EXIT=$?"

cp -r public .next/standalone/ 2>/dev/null
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static

echo "starting standalone…"
# The standalone server does NOT read .env.local (only `next start` does), so
# server-side secrets (SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY) must be
# exported or every admin-client call fails with "supabaseKey is required".
set -a
# shellcheck disable=SC1091
source .env.local
set +a
HOSTNAME=0.0.0.0 PORT=3000 node .next/standalone/server.js > /tmp/exbolt-standalone.log 2>&1 &
SRV=$!
sleep 20

echo "server pid: ${SRV}"
curl -s -o /dev/null -w "login:%{http_code}\n" http://127.0.0.1:3000/login
CSS="$(curl -s http://127.0.0.1:3000/login | grep -o '/_next/static/chunks/[^"]*\.css' | head -1)"
echo "css=${CSS}"
curl -s -o /dev/null -w "css:%{http_code} type:%{content_type}\n" "http://127.0.0.1:3000${CSS}"
tail -5 /tmp/exbolt-standalone.log

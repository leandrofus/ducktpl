#!/usr/bin/env bash
# make dev: the gateway (go run, data in .dev/) and Vite with hot reload,
# side by side. Open http://localhost:5173. Ctrl-C stops both.
# HOST=0.0.0.0 make dev serves the UI to the network too (the gateway stays
# on 127.0.0.1: Vite proxies /api to it).
# The gateway takes the first free port from 8080; DUCKAPP_PORT=8085 picks one
# (and fails if it is taken) so a service already on :8080 is never mistaken for it.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .dev
[ -d web/node_modules ] || (cd web && bun install)
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port=${DUCKAPP_PORT:-}
if [ -z "$port" ]; then
  port=8080
  while busy "$port"; do port=$((port + 1)); done
elif busy "$port"; then
  echo "dev: port $port is in use (DUCKAPP_PORT)" >&2
  exit 1
fi
export DUCKAPP_PORT=$port DUCKAPP_LISTEN=127.0.0.1:$port # web/vite.config.ts proxies /api to DUCKAPP_PORT
export DUCKAPP_DB=${DUCKAPP_DB:-$PWD/.dev/duckapp.db}
# duck:if auth
# A fixed dev password instead of the one-time random one.
export DUCKAPP_ADMIN_PASSWORD=${DUCKAPP_ADMIN_PASSWORD:-admin-password}
# .dev/ keeps its database: without this an admin made by an earlier run keeps its old password.
export DUCKAPP_ADMIN_PASSWORD_RESET=1
# duck:end
# duck:if s3
export DUCKAPP_FILES=${DUCKAPP_FILES:-$PWD/.dev/files}
# duck:end

trap 'kill 0' EXIT
(cd gateway && go run ./cmd/duckapp) &
(cd web && bun run dev --clearScreen false ${HOST:+--host "$HOST"}) &
# duck:if auth
echo "dev: http://${HOST:-localhost}:5173  gateway :$port  (admin / $DUCKAPP_ADMIN_PASSWORD)"
# duck:else
# echo "dev: http://${HOST:-localhost}:5173  gateway :$port"
# duck:end
wait

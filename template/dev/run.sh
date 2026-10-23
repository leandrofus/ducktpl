#!/usr/bin/env bash
# make dev: the gateway (go run, data in .dev/) and Vite with hot reload,
# side by side. Open http://localhost:5173. Ctrl-C stops both.
# HOST=0.0.0.0 make dev serves the UI to the network too (the gateway stays
# on 127.0.0.1: Vite proxies /api to it).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .dev
[ -d web/node_modules ] || (cd web && bun install)
export DUCKAPP_DB=${DUCKAPP_DB:-$PWD/.dev/duckapp.db}
# duck:if auth
# A fixed dev password instead of the one-time random one.
export DUCKAPP_ADMIN_PASSWORD=${DUCKAPP_ADMIN_PASSWORD:-admin-password}
# duck:end
# duck:if s3
export DUCKAPP_FILES=${DUCKAPP_FILES:-$PWD/.dev/files}
# duck:end

trap 'kill 0' EXIT
(cd gateway && go run ./cmd/duckapp) &
(cd web && bun run dev --clearScreen false ${HOST:+--host "$HOST"}) &
# duck:if auth
echo "dev: http://${HOST:-localhost}:5173  (admin / $DUCKAPP_ADMIN_PASSWORD)"
# duck:else
# echo "dev: http://${HOST:-localhost}:5173"
# duck:end
wait

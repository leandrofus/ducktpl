#!/usr/bin/env bash
# Scaffolds the template with several module combinations and, for each one,
# regenerates code, vets and runs the Go tests (and typechecks the UI when
# WEB=1). The template is only right if every combination is.
#
#   scripts/matrix.sh                 the default combinations
#   scripts/matrix.sh auth,rbac ""    just these (an empty one is "none")
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
out=${MATRIX_DIR:-$(mktemp -d)}
mkdir -p "$out"
combos=("$@")
if [ ${#combos[@]} -eq 0 ]; then
  combos=("" "auth" "auth,rbac" "auth,pam" "auth,audit,sse" "audit,ws,sse,redis,s3,ssr" "auth,rbac,s3,ws" "all" "eventbus" "auth,rbac,audit,eventbus,s3,ssr")
fi
sqlc=$here/template/gateway/bin/sqlc
[ -x "$sqlc" ] || make -C "$here/template/gateway" bin/sqlc >/dev/null

fail=0
for i in "${!combos[@]}"; do
  combo=${combos[$i]}
  web=react; [ $((i % 2)) -eq 1 ] && web=preact
  name=m$i
  dir=$out/$name
  rm -rf "$dir"
  echo "── ${combo:-none} ($web)"
  (cd "$out" && node "$here/bin/create-duck.mjs" "$name" --with "$combo" --web "$web" --owner matrix --yes --no-install >/dev/null)
  # errexit is ignored inside a condition, so the status is checked after
  set +e
  (
    set -e
    cd "$dir/gateway"
    mkdir -p bin && cp "$sqlc" bin/
    # the generator must work on every combination too
    (cd .. && node "$here/bin/ducktpl.mjs" addScope projects name:string! --no-generate >/dev/null)
    (cd .. && node "$here/bin/ducktpl.mjs" addToScope projects tasks title:string! due_at:time notes:text done:bool priority:int ratio:float --no-generate >/dev/null)
    # every UI layout must typecheck and build, not only the table
    for ui in cards feed chat; do
      (cd .. && node "$here/bin/ducktpl.mjs" add "${ui}_items" title:string! body:text --ui "$ui" --no-generate >/dev/null)
    done
    go mod tidy >/dev/null 2>&1
    bin/sqlc generate
    gofmt -w .
    test -z "$(gofmt -l .)"
    go run ./cmd/openapi-gen
    go vet ./...
    go test ./... | { grep -v "no test files" || true; }
    if [ "${WEB:-0}" = 1 ]; then
      cd ../web && bun install >/dev/null 2>&1 && bun run gen-api >/dev/null && bun run build >/dev/null
      echo "   web build ok"
    fi
  )
  rc=$?
  set -e
  if [ $rc -ne 0 ]; then
    echo "   FAILED: ${combo:-none} ($web) in $dir"
    fail=1
  fi
done
exit $fail

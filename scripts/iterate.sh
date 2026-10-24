#!/usr/bin/env bash
# Runs a sequence of ducktpl commands on a generated project, one commit and one
# `make test` after each, and prints a table. Run it on a throwaway branch.
#
#   scripts/iterate.sh <project-dir>
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "${1:?project dir}"
branch=$(git branch --show-current)
case "$branch" in
  main|master|"") echo "refusing to commit on '$branch': run this on a throwaway branch (git checkout -b iterate-test)" >&2; exit 1 ;;
esac
dt() { node "$here/bin/ducktpl.mjs" "$@"; }

steps=(
  "add column int            |moddb addColumn posts reading_time:int"
  "add column required       |moddb addColumn posts subtitle:string!"
  "add column enum           |moddb addColumn posts visibility:string:enum(public,private,members)"
  "add column json           |moddb addColumn posts extra:json"
  "add column ref            |moddb addColumn posts reviewer:ref:authors"
  "rename column             |moddb renameColumn posts subtitle tagline"
  "change type               |moddb changeType posts reading_time:float --force"
  "remove column             |moddb removeColumn posts tagline"
  "dto inspect               |dto posts"
  "action                    |addAction posts publish"
  "observer                  |on posts.create indexPost --preset log"
  "new resource              |add newsletters email:string!:unique active:bool"
  "new scope                 |addScope projects name:string!"
  "scoped resource           |addToScope projects socials network:string! url:string!"
  "seed                      |seed 3"
  "remove resource           |remove newsletters"
)

printf '%-26s %-9s %-9s %s\n' step command make-test note
for s in "${steps[@]}"; do
  name=${s%%|*}; cmd=${s#*|}
  out=$(dt $cmd --json 2>&1); rc=$?
  status=$(echo "$out" | jq -r '.status // "?"' 2>/dev/null || echo "?")
  note=""
  if [ "$status" = error ] || [ $rc -ne 0 ]; then
    note=$(echo "$out" | jq -r '(.step // "") + " " + ((.detail // .error // "") | split("\n")[0])' 2>/dev/null | cut -c1-110)
    mt=skipped
  else
    if make test >/tmp/iterate-test.out 2>&1; then mt=ok; else mt=FAIL; note=$(grep -m1 -E "error TS|\.go:[0-9]+|FAIL" /tmp/iterate-test.out | cut -c1-110); fi
  fi
  git add -A >/dev/null 2>&1; git commit -qm "$name" >/dev/null 2>&1
  printf '%-26s %-9s %-9s %s\n' "$name" "$status" "$mt" "$note"
done

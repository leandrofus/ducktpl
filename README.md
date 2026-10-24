# create-duck

Scaffolds an app the way the duck family is built (ducktainer, duckJump,
DuckOps, duckforum): a Go gateway that serves a JSON API and the embedded web
UI as **one binary**, on SQLite or PostgreSQL, with the OpenAPI contract
generated from the code and the UI's types generated from the contract.

[Español](README.es.md)

```sh
bunx create-duck my-app                 # asks (web, RLS tenant model, modules, owner)
npx create-duck my-app --web preact --rls multitenant --with auth,rbac,audit,sse --yes
```

Then `cd my-app && make dev`.

## Modifying database & adding resources later

Inside a generated project:

```sh
# Add a CRUD resource
npx ducktpl add tasks title:string! notes:text done:bool priority:int ratio:float
npx ducktpl --addRoute people full_name:string! --singular person

# Modify database schema across SQLite & PostgreSQL
npx ducktpl moddb addColumn tasks status:string!
npx ducktpl moddb renameColumn tasks title heading
npx ducktpl moddb changeType tasks priority:int! --force
npx ducktpl moddb removeColumn tasks status

# Mold DTOs: prevent data leaks & reduce unnecessary payload
npx ducktpl dto tasks                       # inspect current DTO vs table columns
npx ducktpl dto tasks title done priority   # expose only specific fields
npx ducktpl dto tasks --omit internal_notes # hide internal / sensitive fields
```

It goes through every layer — migrations for both engines, sqlc queries,
handlers with their OpenAPI blocks, routes with their access rule,
permissions (and object grants with `rbac`), an HTTP test, a page with list
and form, the nav entry, live refresh — and runs `make generate`. It reads
which modules the project has, and inserts at the `ducktpl:<place>` anchors.
`--dry-run` lists the changes first.

## What you always get

- **Gateway** (`gateway/`): `net/http` routes with their access rule in one
  place, JSON helpers and error mapping, CSRF by header + SameSite cookies,
  trusted-proxy aware client IPs, security headers and a strict CSP.
- **Store**: SQLite (WAL, one file) or PostgreSQL by URL, goose migrations per
  engine, sqlc queries that run unchanged on both, a test helper that runs every
  suite on either.
- **API contract**: `openapi:operation` / `openapi:schema` comments beside each
  handler and DTO → `openapi.yaml` (cmd/openapi-gen fails on a route without
  docs, a dangling `$ref` or a schema that does not match its struct) →
  `api-types.ts` with openapi-typescript. CI fails when either is stale.
- **Web UI** (`web/`): the ducktainer design system (tokens, light/dark,
  sidebar shell, Ctrl-K palette, DataTable, drawers, modals, context menus,
  toasts), hash router, cached `useResource`, i18n (English source + Spanish).
- **An example resource** (notes) wired through every layer, and a CLAUDE.md
  with the conventions and the add-an-endpoint loop.
- `make dev | build | generate | test | test-postgres | dist`.

## Modules (all opt-in)

| Module | Adds |
|---|---|
| `auth` | Users, bcrypt, DB sessions (idle + absolute expiry), login rate limit, first admin bootstrap, permissions per role, login/account/users pages |
| `rbac` | Editable roles with permission lists, and **grants per object** (a user or a role gets one permission on one object); share UI on notes. Needs `auth` |
| `pam` | System users sign in through PAM (ducktainer style: `-tags pam`, socket-activated root helper, groups → roles, systemd units). Needs `auth` |
| `audit` | Tamper-evident log: HMAC-SHA256 hash chain, append-only table on both engines, verify endpoint and page |
| `ws` | WebSocket live events (`note.changed` → UI refetches) |
| `sse` | The same over Server-Sent Events |
| `redis` | Shared cache, and live events across gateways via pub/sub; memory when not configured |
| `s3` | File attachments in S3/MinIO via minio-go; a directory when not configured |
| `ssr` | duckforum-style first paint: Go fills `<!--ssr-head-->`/`<!--ssr-body-->` in the built index.html |
| `ci` | GitHub Actions: tests on SQLite and PostgreSQL, tag on version bump, static release binaries |
| `site` | Astro site for GitHub Pages in the duck palette |

`--web preact` swaps the runtime only: the same code is typechecked against
React's types and bundled with preact/compat (about 80 KB instead of 280 KB).

## How the template works

`template/` is a working project with **every module on** (it builds and its
tests pass as it is). Optional code sits between markers in any comment
syntax:

```go
// duck:if audit
s.recordAudit(r, p.IP, id, username, action, targetType, targetID, details)
// duck:else
// slog.Info(action, ...)
// duck:end
```

A file can be dropped whole with a first line `// duck:file rbac`.
Conditions are AND of terms, a term is `a|b` alternatives, `!` negates:
`duck:if audit !auth`, `duck:if ws|sse redis`. A block that is off by default is
written commented out, and the CLI uncomments it when chosen. The placeholders
`duckapp`, `DuckApp`, `DUCKAPP` and `github.com/duckowner/duckapp` become your
names.

Working on the template:

```sh
cd template && make dev               # it is a normal app
node bin/create-duck.mjs --check      # every block that is off is commented out
WEB=1 scripts/matrix.sh               # scaffold 8 combinations; vet, test and build each
```

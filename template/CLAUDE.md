# DuckApp — how this codebase works

Scaffolded with create-duck. These are the conventions every duck project
follows; keep them when adding code.

## Layout

```
gateway/                      Go module: the whole server, one binary
  cmd/duckapp/                flags (each has a DUCKAPP_<NAME> env var), wiring, startup
  cmd/openapi-gen/            builds openapi/openapi.yaml from comments (see "API contract")
  openapi/root.yaml           the hand-written part of the spec; openapi.yaml is generated
  internal/server/            HTTP: routes (server.go), access (access.go), one file per resource
  internal/store/             database: migrations/{sqlite,postgres}, queries/*.sql, db/ (sqlc, generated)
<!-- duck:if auth -->
  internal/auth/              passwords, sessions, permissions catalog (perms.go)
<!-- duck:end -->
<!-- duck:if audit -->
  internal/audit/             HMAC hash-chained audit log
<!-- duck:end -->
<!-- duck:if ws|sse -->
  internal/events/            change events for live clients (in-process, or over Redis)
<!-- duck:end -->
<!-- duck:if redis -->
  internal/cache/             memory or Redis cache
<!-- duck:end -->
<!-- duck:if s3 -->
  internal/objstore/          file contents: S3 or a directory
<!-- duck:end -->
web/                          the UI (Vite + TypeScript), built into the gateway
  src/styles.css              the design system: tokens first, components after
  src/ui/                     shared components (DataTable, Modal, Drawer, ContextMenu, toasts…)
  src/lib/api.ts              fetch wrapper + types re-exported from api-types.ts (generated)
  src/lib/store.ts            useResource(path): cached, revalidating reads; invalidate(prefix)
  src/i18n/                   t('English source'); es.ts maps it to Spanish
  src/pages/                  one file per section
  src/resources/              what each generated resource is (url, labels, fields, layout): no JSX
  src/ui/resource/            ResourcePage, ResourceDialog and the layouts, drawn from a resource
  src/lib/create.ts           create(): a zustand-style store; lib/list.ts keeps a list's page and search
```

## Commands

- `make dev` — gateway on :8080 + Vite on :5173 with hot reload (open :5173).
- `make generate` — after touching SQL or an `openapi:` comment: sqlc, openapi.yaml, api-types.ts.
- `make test` — vet, tests, spec up to date, UI typecheck. `make test-postgres` runs the suites on PostgreSQL.
- `make build` — `dist/bin/duckapp`, UI embedded.

## Adding resources: always ducktpl first

**Never hand-write a CRUD resource, a column change or a DTO change.** Use the
generator; it writes every layer below, runs `make generate` and rolls back if
the build breaks:

- `npx ducktpl info --json` — modules, tables and types of this project
- `npx ducktpl add tasks title:string! notes:text done:bool priority:int --json`
- `npx ducktpl apply schema.yaml --json` — several related resources at once
- `npx ducktpl moddb addColumn|removeColumn|renameColumn|changeType … --json`
- `npx ducktpl dto|addAction|on|remove|module … --json` — `npx ducktpl --help`
- `npx ducktpl check --json` — after hand edits

It inserts lines at the `ducktpl:<place>` comments: keep them. Hand-write only
what the generator does not cover (business logic, custom UI), inside the code
it generated.

## Adding an endpoint by hand (reference)

What ducktpl does, for code it cannot generate:

1. **Schema**: a migration in *both* `migrations/sqlite` and `migrations/postgres`
   (same number). sqlc reads types from the PostgreSQL one.
2. **Query** in `internal/store/queries/<resource>.sql` with `@name`
   parameters. It must run on both engines: compare timestamps with
   `julianday()`, cast nullable filters (`CAST(@x AS TEXT) = '' OR …`).
3. **Handler** in `internal/server/<resource>.go`, signature
   `func (s *Server) x(w, r, p principal) error`. Return errors; `writeErr`
   maps them (`badRequest`, `notFound`, `conflict`, `forbidden`,
   `fromStore(err, "thing")`). Helpers: `handleCreated`, `handleAction`,
   `handleCommand`, `decode` (rejects unknown fields), `opt[T]` for PATCH.
4. **Contract**: an `// openapi:operation` block above the handler and an
   `// openapi:schema Name` block above each DTO, each followed by a blank
   line (gofmt would mangle YAML in a doc comment). A schema bound to a
   struct must list exactly its JSON fields — openapi-gen fails otherwise.
   Path params, security, CSRF header and standard errors are derived.
5. **Route** in `Server.Handler` with its access rule:
<!-- duck:if auth -->
   `s.public(h)`, `s.signedIn(h)` or `s.can(auth.PermX, h)`. Object checks go
   inside the handler: `s.allow(r, p, perm, "type", id)`, and lists filter
   with `s.visible(...)`. New permissions go in `internal/auth/perms.go`.
<!-- duck:end -->
<!-- duck:if !auth -->
<!--    `s.public(h)`. -->
<!-- duck:end -->
6. **Side effects** after a successful write: `s.record(r, p, "thing.verb",
   "thing", id, details)` (audit or log) and `s.changed(r, "thing", id)`
   (cache invalidation, live events).
7. `make generate`, then use the new types in the UI from `lib/api.ts`.
8. Test it in `internal/server/server_test.go` through HTTP (`newClient`,
   `c.must(status, method, path, body, &out)`).

## Rules

- IDs are UUIDv7 strings from `store.NewID()`; timestamps come from
  `store.Now()` (UTC, microseconds) — never SQL defaults.
- Writes that read then write go in `s.Store.Tx` (serialized on both engines).
- State-changing requests need the `X-DuckApp-Request` header (CSRF); the UI's
  `api` client sends it.
- The UI loads nothing from other origins (CSP `default-src 'self'`): no CDNs,
  bundle what you need.
- UI text is English inside `t()`; add the Spanish to `src/i18n/es.ts`.
- Style with the tokens in `styles.css` (`--accent`, `--surface`, `--ok`…) and
  the existing classes (`page`, `page-head`, `btn`, `field`, `tag`…). Change the
  brand by changing `--accent*` only.
- Reuse `ui/common.tsx` (DataTable, Section, Props, Tag, Pill, Empty,
  MenuButton) and `ui/overlays.tsx` (Modal, Drawer, confirm, prompt, toast)
  before writing new components. Right-click menus come from `useMenu()`.

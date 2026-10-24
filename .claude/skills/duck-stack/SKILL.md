---
name: duck-stack
description: Use whenever the user asks to create, build or start a new app, web app, backend, API, dashboard or full-stack project in any language (e.g. "crea una app de citas", "build me a CRM", "hazme un backend con login") — the first step is ALWAYS `npx create-duck --manifest duck.yaml --yes --json`. Also use inside an existing Duck Stack project (has `gateway/` + `web/` and `ducktpl:` anchors) to add resources, data models, endpoints, migrations, DTOs, actions, events or modules with `npx ducktpl ... --json` instead of hand-writing code. Go + SQLite/PostgreSQL + React/Preact, one binary.
---

# Duck Stack

`create-duck` scaffolds the app; `ducktpl` generates every layer of a resource (twin SQLite/PostgreSQL migrations, sqlc queries, Go handler with OpenAPI, route, permissions, HTTP test, UI page) and rolls back if the build, `go vet` or the UI typecheck fails.

## New app (empty directory)

Write no code first.

1. Write `duck.yaml` (block style only: no `[a, b]`, no `{…}`, no trailing comments):
   ```yaml
   app:
     name: citas
     web: react
     rls: singleTenant
     modules:
       - auth
       - eventbus
       - ws
   resources:
     profiles:
       ui: cards
       fields:
         - display_name:string!
         - age:int:min(18)
         - status:string!:enum(online,away,offline)
     swipes:
       fields:
         - profile:ref:profiles!
         - direction:string!:enum(like,pass)
     matches:
       fields:
         - profile:ref:profiles!
         - target_id:string!
   pipelines:
     - on: swipes.create
       name: processMatch
       preset: match_reciprocal
       target: matches
   ```
   `name`: lowercase/digits/dashes, becomes `./<name>/`. `web`: react | preact. `rls`: singleTenant | multitenant. Modules: `npx create-duck --help`. `ui`: table (default) | cards | feed | chat. `pipelines` need `eventbus`.
2. `npx create-duck --manifest duck.yaml --yes --json`
3. `cd <name> && npx ducktpl check --json && make test`
4. Keep the built-in `notes` resource: core tests and modules use it (`remove notes` refuses). Drop its nav entry in `web/src/App.tsx` if unwanted.
5. Only now hand-write what is specific to the app, inside the generated code, following the project's `CLAUDE.md`.

## Existing project

Start with `npx ducktpl info --json` (modules, tables, types). Always pass `--json`; `--dry-run` previews.

| Task | Command |
|---|---|
| CRUD resource | `ducktpl add tasks title:string! done:bool priority:int:default(0)` |
| Several related resources | `ducktpl apply schema.yaml` (`resources:` + `pipelines:` as above) |
| Reference another table | `ducktpl add comments body:text! task:ref:tasks!` |
| Container + nested resource | `ducktpl addScope projects name:string!` → `ducktpl addToScope projects tasks title:string!` |
| Column changes | `ducktpl moddb addColumn\|removeColumn tasks …`, `renameColumn tasks old new`, `changeType tasks col:int! --force` |
| Hide fields from the API | `ducktpl dto tasks --omit internal_notes` (inspect: `ducktpl dto tasks`) |
| Command endpoint | `ducktpl addAction tasks complete` → `POST /api/v1/tasks/{id}/complete` |
| React to an event | `ducktpl on swipes.create processMatch --preset match_reciprocal` (log, email, cache, webhook, pipe) |
| Optional module later | `ducktpl module list`, `ducktpl module add audit` |
| Mock data | `ducktpl seed 5` |
| Remove a resource | `ducktpl remove tasks` |
| Health | `ducktpl check` |

All are `npx ducktpl … --json`.

Fields: `name:type[!][:modifier…]`. Types: string, text, int, float, bool, time, date, json, uuid, bytes, `ref:<table>`. Modifiers: `unique`, `index`, `default(v)`, `enum(a,b)`, `min(n)`, `max(n)`. Type mapping per engine, EventBus API and rollback details: [reference.md](reference.md).

## Rules

- Never hand-write CRUD boilerplate, migrations or DTO changes: use `ducktpl`.
- Keep every `// ducktpl:<place>` anchor comment; the generator inserts there.
- On `"status": "error"`, read `step` and `detail` (file and line), fix the cause, and run the same command again; the workspace was rolled back.
- `dto --omit` on a field the UI shows fails the typecheck: edit the page first.

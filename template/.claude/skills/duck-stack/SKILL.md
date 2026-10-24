---
name: duck-stack
description: Scaffolds and manages full-stack Go + SQLite/PostgreSQL + Preact/React applications using create-duck and ducktpl. Automates database migrations, sqlc queries, Go handlers with OpenAPI annotations, permissions, UI pages, custom RPC actions, and declarative schemas with deterministic CLI commands and zero boilerplate.
---

# Duck Stack Agentic Skill

This skill guides AI agents in scaffolding, extending, and modifying full-stack applications built with the **Duck Stack** (`create-duck` and `ducktpl`).

## Golden Rules for AI Agents

1. **NEVER manually write CRUD boilerplate from scratch.**
   - Do NOT hand-craft twin SQLite/PostgreSQL migrations, `sqlc` queries, Go HTTP handlers, OpenAPI YAML comments, and Preact pages when adding a resource.
   - Use `npx ducktpl add <resource> <fields...> --json` or `npx ducktpl apply schema.yaml --json` instead.
2. **ALWAYS inspect before guessing.**
   - Run `npx ducktpl info --json` to detect active features (`auth`, `rbac`, `multitenant`, `live`), existing database tables, and valid types.
3. **ALWAYS use `--json` for tool calls.**
   - `--json` provides clean, structured output without ANSI escape codes, reporting exact files created/updated and actionable warnings.
4. **Preserve Anchors (`ducktpl:<place>`).**
   - The template relies on comments like `// ducktpl:routes`, `// ducktpl:perms`, `// ducktpl:catalog`.
   - Never remove or overwrite these comment lines when editing code.
5. **Shape DTOs to prevent data leaks.**
   - Run `npx ducktpl dto <resource> --omit <fields...> --json` to hide internal or sensitive database columns from API responses.
6. **Verify Project Health.**
   - Run `npx ducktpl check --json` after complex changes to verify anchor integrity, migration parity, and Go/TS compilation.

---

## Command Reference

### 1. Project Introspection & Health Check
```sh
# Inspect project features, tables, types, and anchors
npx ducktpl info --json

# Verify project sanity (anchors, migrations parity, Go vet)
npx ducktpl check --json
```

### 2. Scaffold Resources

#### Standard CRUD Resource (with Modifiers)
Generates migrations (SQLite + PG), sqlc query, Go handler + OpenAPI, route registration, auth permissions, HTTP test, and UI DataTable/Form:
```sh
npx ducktpl add tasks title:string! notes:text done:bool priority:int:default(0) --json
npx ducktpl add users email:string!:unique slug:string:index --json
```

#### Container Scope & Scoped Resources
Create a parent container and nested resources:
```sh
# Parent container (e.g. projects)
npx ducktpl addScope projects name:string! --json

# Nested resource inside parent
npx ducktpl addToScope projects tasks title:string! done:bool --json
```

#### Relational References (`ref:<table>`)
Link to an existing table. Automatically handles foreign keys, indexes, cascades, and test seed helpers:
```sh
npx ducktpl add comments body:text! task:ref:tasks! --json
```

### 3. Declarative Schema Batch (`apply`)
Scaffold multiple interrelated resources in a single tool call from a YAML or JSON schema. Handles topological ordering of references automatically:

```sh
npx ducktpl apply schema.yaml --json
```

Example `schema.yaml`:
```yaml
resources:
  authors:
    fields:
      - name:string!
      - email:string!:unique
  articles:
    fields:
      - title:string!
      - author:ref:authors!
      - slug:string:index
      - status:string:default(draft)
```

### 4. Custom RPC / Actions (`addAction`)
Generate custom state-changing or command endpoints (e.g. `POST /api/v1/tasks/{id}/complete`):
```sh
npx ducktpl addAction tasks complete --json
npx ducktpl addAction invoices send --json
```

### 5. Safe Resource Removal (`remove`)
Safely remove a scaffolded resource, deleting its files and cleaning up its lines in routes, auth, rbac, and web navigation:
```sh
npx ducktpl remove tasks --json
```

### 6. Database Schema Modifications (`moddb`)
Safely alters SQLite and PostgreSQL schemas, sqlc queries, and Go handlers:

```sh
# Add a column
npx ducktpl moddb addColumn tasks status:string! --json

# Remove a column
npx ducktpl moddb removeColumn tasks notes --json

# Change column type (requires --force)
npx ducktpl moddb changeType tasks priority:int! --force --json

# Rename column
npx ducktpl moddb renameColumn tasks title heading --json
```

### 7. DTO Shaping & Leak Prevention (`dto`)
Inspect and mold API response schemas without breaking database models:

```sh
# Inspect exposed vs protected fields
npx ducktpl dto notes --json

# Expose only specific fields
npx ducktpl dto notes title body --json

# Omit internal or sensitive fields (e.g., hashed password, internal notes)
npx ducktpl dto notes --omit pinned,internal_notes --json
```

---

## Supported Field Types & Modifiers

| Type | SQLite | PostgreSQL | Go Type | TypeScript | Example |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `string` | `TEXT NOT NULL DEFAULT ''` | `TEXT NOT NULL DEFAULT ''` | `string` | `string` | `title:string!` |
| `text` | `TEXT NOT NULL DEFAULT ''` | `TEXT NOT NULL DEFAULT ''` | `string` | `string` | `content:text` |
| `int` | `INTEGER NOT NULL DEFAULT 0` | `BIGINT NOT NULL DEFAULT 0` | `int64` | `number` | `priority:int!` |
| `float` | `REAL NOT NULL DEFAULT 0` | `DOUBLE PRECISION NOT NULL DEFAULT 0` | `float64` | `number` | `price:float` |
| `bool` | `BOOLEAN NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT false` | `bool` | `boolean` | `done:bool` |
| `time` | `DATETIME` | `TIMESTAMPTZ` | `time.Time` | `string` | `due_at:time` |
| `date` | `TEXT` | `DATE` | `string` | `string` | `birthdate:date` |
| `json` | `TEXT NOT NULL DEFAULT '{}'` | `JSONB NOT NULL DEFAULT '{}'` | `string` | `Record<string, unknown>` | `metadata:json` |
| `uuid` | `TEXT NOT NULL DEFAULT ''` | `TEXT NOT NULL DEFAULT ''` | `string` | `string` | `external_id:uuid` |
| `bytes` | `BLOB` | `BYTEA` | `[]byte` | `string` | `data:bytes` |
| `ref:<tbl>` | `TEXT REFERENCES ...` | `TEXT REFERENCES ...` | `string` | `string` | `project:ref:projects!` |

### Modifiers
- `!` : Required column (`title:string!`)
- `:unique` : Adds `UNIQUE` constraint in migrations (`email:string!:unique`)
- `:index` : Creates index in SQLite and Postgres (`slug:string:index`)
- `:default(<val>)` : Sets custom default value in schema (`status:string:default(pending)`)

---

## Atomic Rollback & Error Recovery

`ducktpl` includes an **automatic transactional rollback** mechanism:
- If `sqlc generate`, `gofmt`, `openapi-gen`, or UI type generation fails after files are touched, `ducktpl` **automatically restores modified files and removes newly created files**.
- The git workspace remains 100% clean, avoiding broken intermediate states.
- If you need to debug a build failure without rolling back, pass `--no-rollback`.

### Recovering from Broken Anchors
If an anchor was accidentally deleted, `ducktpl check --json` will report the exact file and missing anchor.
Simply restore `// ducktpl:<anchor>` at the reported location and re-run.

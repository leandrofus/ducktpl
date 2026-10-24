---
name: duck-stack
description: Scaffolds and manages full-stack Go + SQLite/PostgreSQL + Preact/React applications using create-duck and ducktpl. Automates database migrations, sqlc queries, Go handlers with OpenAPI annotations, permissions, and UI pages with deterministic CLI commands and zero boilerplate.
---

# Duck Stack Agentic Skill

This skill guides AI agents in scaffolding, extending, and modifying full-stack applications built with the **Duck Stack** (`create-duck` and `ducktpl`).

## Golden Rules for AI Agents

1. **NEVER manually write CRUD boilerplate from scratch.**
   - Do NOT hand-craft twin SQLite/PostgreSQL migrations, `sqlc` queries, Go HTTP handlers, OpenAPI YAML comments, and Preact pages when adding a resource.
   - Use `npx ducktpl add <resource> <fields...> --json` instead.
2. **ALWAYS inspect before guessing.**
   - Run `npx ducktpl info --json` to detect active features (`auth`, `rbac`, `multitenant`, `live`), existing database tables, and valid types.
3. **ALWAYS use `--json` for tool calls.**
   - `--json` provides clean, structured output without ANSI escape codes, reporting exact files created/updated and actionable warnings.
4. **Preserve Anchors (`ducktpl:<place>`).**
   - The template relies on comments like `// ducktpl:routes`, `// ducktpl:perms`, `// ducktpl:catalog`.
   - Never remove or overwrite these comment lines when editing code.
5. **Shape DTOs to prevent data leaks.**
   - Run `npx ducktpl dto <resource> --omit <fields...> --json` to hide internal or sensitive database columns from API responses.

---

## Command Reference

### 1. Project Introspection
Inspect project modules, existing tables, anchors, and supported types:
```sh
npx ducktpl info --json
```

### 2. Scaffold Resources

#### Standard CRUD Resource
Generates migrations (SQLite + PG), sqlc query, Go handler + OpenAPI, route registration, auth permissions, HTTP test, and UI DataTable/Form:
```sh
npx ducktpl add tasks title:string! notes:text done:bool priority:int --json
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

### 3. Database Schema Modifications (`moddb`)
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

> [!NOTE]
> `moddb` automatically detects if a frontend page (`web/src/pages/<resource>.tsx`) exists and provides clear notes on what UI elements to sync.

### 4. DTO Shaping & Leak Prevention (`dto`)
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

- Append `!` to make the column required (`title:string!`).
- Common aliases are supported: `boolean` -> `bool`, `integer`/`bigint` -> `int`, `varchar` -> `string`, `jsonb` -> `json`, `datetime`/`timestamp` -> `time`.

---

## Atomic Rollback & Error Recovery

`ducktpl` includes an **automatic transactional rollback** mechanism:
- If `sqlc generate`, `gofmt`, `openapi-gen`, or UI type generation fails after files are touched, `ducktpl` **automatically restores modified files and removes newly created files**.
- The git workspace remains 100% clean, avoiding broken intermediate states.
- If you need to debug a build failure without rolling back, pass `--no-rollback`.

### Recovering from Broken Anchors
If an anchor was accidentally deleted, `ducktpl` will report the exact file and missing anchor:
```
gateway/internal/server/server.go: anchor "ducktpl:routes" not found. Re-add "// ducktpl:routes" or "# ducktpl:routes" where new entries should be injected.
```
Simply restore `// ducktpl:<anchor>` at the appropriate location and re-run the command.

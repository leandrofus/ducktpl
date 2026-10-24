// A mock create-duck project with the files the generators insert into.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function setupMockProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-test-'))
  mkdirSync(join(dir, 'gateway/internal/store/migrations/sqlite'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/store/migrations/postgres'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/store/queries'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/server'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/auth'), { recursive: true })
  mkdirSync(join(dir, 'web/src/pages'), { recursive: true })
  mkdirSync(join(dir, 'web/src/lib'), { recursive: true })

  writeFileSync(join(dir, 'gateway/go.mod'), 'module github.com/test/app/gateway\n\ngo 1.26\n')
  writeFileSync(join(dir, 'web/package.json'), '{"name": "test-web"}\n')

  const sqlite00001 = `-- +goose Up
CREATE TABLE items (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    priority   TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX items_priority_idx ON items (priority);

-- +goose Down
DROP TABLE items;
`
  const pg00001 = `-- +goose Up
CREATE TABLE items (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    priority   TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX items_priority_idx ON items (priority);

-- +goose Down
DROP TABLE items;
`
  const queries = `-- name: ListItems :many
SELECT * FROM items ORDER BY updated_at DESC;

-- name: GetItem :one
SELECT * FROM items WHERE id = @id;

-- name: CreateItem :exec
INSERT INTO items (id, title, priority, created_at, updated_at)
VALUES (@id, @title, @priority, @now, @now);
`

  writeFileSync(join(dir, 'gateway/internal/store/migrations/sqlite/00001_items.sql'), sqlite00001)
  writeFileSync(join(dir, 'gateway/internal/store/migrations/postgres/00001_items.sql'), pg00001)
  writeFileSync(join(dir, 'gateway/internal/store/queries/items.sql'), queries)
  writeFileSync(join(dir, 'web/src/pages/Items.tsx'), '// items page\nexport function Items() { return null }\n')
  writeFileSync(join(dir, 'gateway/internal/server/items.go'), 'package server\nfunc toItem() {}\n')
  writeFileSync(join(dir, 'gateway/internal/server/items_test.go'), 'package server\n// no seedItem here\n')
  writeFileSync(join(dir, 'gateway/internal/server/server_test.go'), 'package server\n// test server\n')
  writeFileSync(join(dir, 'gateway/internal/server/server.go'), 'package server\nfunc Handler() {\n// ducktpl:routes\n}\n')
  writeFileSync(join(dir, 'gateway/internal/auth/perms.go'), 'package auth\nconst (\n// ducktpl:perms\n)\nvar Catalog = []any{\n// ducktpl:catalog\n}\nvar User = []any{\n// ducktpl:user-perms\n}\n')
  writeFileSync(join(dir, 'web/src/lib/api.ts'), '// api types\n// ducktpl:types\n')
  writeFileSync(join(dir, 'web/src/App.tsx'), '// ducktpl:imports\n// ducktpl:nav\n// ducktpl:pages\n')

  return dir
}

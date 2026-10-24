import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planModdb } from './moddb.mjs'
import { applyWithRollback, plan, resourceNames, parseFields } from './generate.mjs'

function setupMockProject() {
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
  writeFileSync(join(dir, 'gateway/internal/server/server_test.go'), 'package server\n// test server\n')
  writeFileSync(join(dir, 'gateway/internal/server/server.go'), 'package server\nfunc Handler() {\n// ducktpl:routes\n}\n')
  writeFileSync(join(dir, 'gateway/internal/auth/perms.go'), 'package auth\nconst (\n// ducktpl:perms\n)\nvar Catalog = []any{\n// ducktpl:catalog\n}\nvar User = []any{\n// ducktpl:user-perms\n}\n')
  writeFileSync(join(dir, 'web/src/lib/api.ts'), '// api types\n// ducktpl:types\n')
  writeFileSync(join(dir, 'web/src/App.tsx'), '// ducktpl:imports\n// ducktpl:nav\n// ducktpl:pages\n')

  return dir
}

test('planModdb changeType preserves SQLite indexes and wraps foreign keys', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planModdb(p, 'changeType', ['items', 'priority:int!'], { force: true })

    const sqliteMig = planned.files.find((f) => f.path.includes('sqlite') && f.path.includes('change_priority_type'))
    assert.ok(sqliteMig)
    assert.ok(sqliteMig.content.includes('PRAGMA foreign_keys = OFF;'))
    assert.ok(sqliteMig.content.includes('PRAGMA foreign_keys = ON;'))
    assert.ok(sqliteMig.content.includes('CREATE INDEX items_priority_idx ON items (priority);'))

    const pgMig = planned.files.find((f) => f.path.includes('postgres') && f.path.includes('change_priority_type'))
    assert.ok(pgMig)
    assert.ok(pgMig.content.includes('USING NULLIF(priority::text, \'\')::BIGINT'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planModdb detects existing frontend pages and provides actionable notes', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planModdb(p, 'addColumn', ['items', 'status:string!'])
    assert.equal(planned.frontendPage, 'web/src/pages/Items.tsx')
    assert.ok(planned.notes.some((n) => n.includes('web/src/pages/Items.tsx')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyWithRollback restores modified files and deletes created files on rollback', () => {
  const dir = setupMockProject()
  try {
    const existingFile = 'web/src/pages/Items.tsx'
    const newFile = 'web/src/pages/NewComponent.tsx'
    const originalContent = readFileSync(join(dir, existingFile), 'utf8')

    const files = [
      { path: existingFile, content: '// MODIFIED CONTENT', created: false },
      { path: newFile, content: '// BRAND NEW FILE', created: true },
    ]

    const handle = applyWithRollback(dir, files)

    assert.equal(readFileSync(join(dir, existingFile), 'utf8'), '// MODIFIED CONTENT')
    assert.equal(existsSync(join(dir, newFile)), true)

    // Trigger rollback
    handle.rollback()

    assert.equal(readFileSync(join(dir, existingFile), 'utf8'), originalContent)
    assert.equal(existsSync(join(dir, newFile)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('plan auto-scaffolds missing seed helpers for ref tables instead of throwing', () => {
  const dir = setupMockProject()
  try {
    const p = {
      root: dir,
      auth: true,
      rbac: false,
      live: false,
      multitenant: false,
    }

    const n = resourceNames('tasks', 'task')
    const fields = parseFields(['title:string!', 'parent:ref:items!'])

    // Prior to our improvement, this threw: tests need a seedItem helper
    const planned = plan(p, n, fields, { cmd: 'add' })

    const testPatch = planned.files.find((f) => f.path === 'gateway/internal/server/server_test.go')
    assert.ok(testPatch)
    assert.ok(testPatch.content.includes('func seedItem(c *client) string'))
    assert.ok(planned.notes.some((note) => note.includes('auto-scaffolded test helper "seedItem"')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

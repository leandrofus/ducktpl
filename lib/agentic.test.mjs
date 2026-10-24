import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planModdb } from './moddb.mjs'
import { applyWithRollback, plan, resourceNames, parseFields } from './generate.mjs'
import { planApply, parseSchemaText } from './apply.mjs'
import { planRemove } from './remove.mjs'
import { planAction } from './action.mjs'
import { checkProject } from './doctor.mjs'
import { listModules, activateModule } from './modules.mjs'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')

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
  writeFileSync(join(dir, 'gateway/internal/server/items.go'), 'package server\nfunc toItem() {}\n')
  writeFileSync(join(dir, 'gateway/internal/server/items_test.go'), 'package server\n// no seedItem here\n')
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

test('parseFields and plan support :unique, :index, and :default(...) modifiers', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const n = resourceNames('users', 'user')
    const fields = parseFields(['email:string!:unique', 'slug:string:index', 'status:string!:default(pending)'])

    const planned = plan(p, n, fields, { cmd: 'add' })
    const migSqlite = planned.files.find((f) => f.path.includes('sqlite') && f.path.includes('users.sql'))
    assert.ok(migSqlite)
    assert.ok(migSqlite.content.includes('email      TEXT NOT NULL DEFAULT \'\' UNIQUE'))
    assert.ok(migSqlite.content.includes('status     TEXT NOT NULL DEFAULT \'pending\''))
    assert.ok(migSqlite.content.includes('CREATE INDEX users_slug ON users (slug);'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planApply correctly sorts and plans multi-resource schemas', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const schemaYaml = `
resources:
  authors:
    fields:
      - name:string!
  articles:
    fields:
      - title:string!
      - author:ref:authors!
`
    const planned = planApply(p, schemaYaml)
    assert.equal(planned.resources.length, 2)
    assert.equal(planned.resources[0].resource, 'authors')
    assert.equal(planned.resources[1].resource, 'articles')
    assert.ok(planned.files.some((f) => f.path.includes('authors.sql')))
    assert.ok(planned.files.some((f) => f.path.includes('articles.sql')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planAction generates action endpoint, route and test', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const planned = planAction(p, 'items', 'archive')

    assert.equal(planned.route, 'POST /api/v1/items/{id}/archive')
    const handlerPatch = planned.files.find((f) => f.path.includes('items.go'))
    assert.ok(handlerPatch)
    assert.ok(handlerPatch.content.includes('archiveItem'))
    assert.ok(handlerPatch.content.includes('openapi:operation'))
    assert.ok(handlerPatch.content.includes('Archive a item'))

    const serverPatch = planned.files.find((f) => f.path.includes('server.go'))
    assert.ok(serverPatch)
    assert.ok(serverPatch.content.includes('POST /api/v1/items/{id}/archive'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planRemove plans clean deletion of resource and anchor cleanups', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const planned = planRemove(p, 'items')

    assert.ok(planned.filesToDelete.some((f) => f.includes('00001_items.sql')))
    assert.ok(planned.filesToDelete.some((f) => f.includes('queries/items.sql')))
    assert.ok(planned.filesToDelete.some((f) => f.includes('items.go')))
    assert.ok(planned.filesToDelete.some((f) => f.includes('Items.tsx')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkProject verifies healthy project anchors and parity', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: true, rbac: false, live: false, multitenant: false }
    const report = checkProject(p)
    assert.equal(report.healthy, true)
    assert.equal(report.issues.length, 0)
    assert.ok(report.passed.length >= 6)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseSchemaText parses app settings and resources from blueprint YAML', () => {
  const yaml = `
app:
  name: bookstore
  web: preact
  rls: singleTenant
  modules:
    - eventbus
    - audit

resources:
  authors:
    fields:
      name: string!
      bio: text
  books:
    scope: authors
    fields:
      title: string!
      price: float:default(0)
`
  const { app, resources } = parseSchemaText(yaml)
  assert.equal(app.name, 'bookstore')
  assert.equal(app.web, 'preact')
  assert.equal(app.rls, 'singleTenant')
  assert.deepEqual(app.modules, ['eventbus', 'audit'])
  assert.equal(Object.keys(resources).length, 2)
  assert.ok(resources.authors)
  assert.ok(resources.books)
  assert.equal(resources.books.inScope, 'authors')
  assert.deepEqual(resources.authors.fields, ['name:string!', 'bio:text'])
  assert.deepEqual(resources.books.fields, ['title:string!', 'price:float:default(0)'])
})

test('listModules and activateModule opt into eventbus and audit', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, module: 'github.com/test/app' }
    const initialMods = listModules(p)
    const evMod = initialMods.find((m) => m.id === 'eventbus')
    assert.equal(evMod.active, false)

    // Activate eventbus
    const res = activateModule(p, TEMPLATE, 'eventbus')
    assert.equal(res.status, 'ok')
    assert.equal(res.alreadyActive, false)
    assert.ok(existsSync(join(dir, 'gateway/internal/events/events.go')))

    // Verify listModules now shows eventbus as active
    const updatedMods = listModules(p)
    assert.equal(updatedMods.find((m) => m.id === 'eventbus').active, true)

    // Activate audit
    const resAudit = activateModule(p, TEMPLATE, 'audit')
    assert.equal(resAudit.status, 'ok')
    assert.ok(existsSync(join(dir, 'gateway/internal/audit/audit.go')))
    assert.ok(existsSync(join(dir, 'gateway/internal/server/audit.go')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

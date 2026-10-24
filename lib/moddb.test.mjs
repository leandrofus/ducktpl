import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findTable, inspectTable, parseFieldSpec, updateQueries, planModdb } from './moddb.mjs'

function setupMockProject() {
  const dir = mkdtempSync(join(tmpdir(), 'moddb-test-'))
  mkdirSync(join(dir, 'gateway/internal/store/migrations/sqlite'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/store/migrations/postgres'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/store/queries'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/server'), { recursive: true })
  mkdirSync(join(dir, 'web'), { recursive: true })

  writeFileSync(join(dir, 'gateway/go.mod'), 'module github.com/test/app/gateway\n\ngo 1.26\n')
  writeFileSync(join(dir, 'web/package.json'), '{"name": "test-web"}\n')

  const sqlite00001 = `-- +goose Up
CREATE TABLE notes (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL UNIQUE,
    body       TEXT NOT NULL DEFAULT '',
    pinned     BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

-- +goose Down
DROP TABLE notes;
`
  const pg00001 = `-- +goose Up
CREATE TABLE notes (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL UNIQUE,
    body       TEXT NOT NULL DEFAULT '',
    pinned     BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE notes;
`
  const queries = `-- name: ListNotes :many
SELECT * FROM notes ORDER BY updated_at DESC;

-- name: CreateNote :exec
INSERT INTO notes (id, title, body, pinned, created_at, updated_at)
VALUES (@id, @title, @body, @pinned, @now, @now);

-- name: UpdateNote :exec
UPDATE notes SET title = @title, body = @body, pinned = @pinned, updated_at = @now WHERE id = @id;
`

  writeFileSync(join(dir, 'gateway/internal/store/migrations/sqlite/00001_init.sql'), sqlite00001)
  writeFileSync(join(dir, 'gateway/internal/store/migrations/postgres/00001_init.sql'), pg00001)
  writeFileSync(join(dir, 'gateway/internal/store/queries/notes.sql'), queries)

  return dir
}

test('parseFieldSpec parses formats, aliases, refs and new types correctly', () => {
  const f1 = parseFieldSpec('status:string!')
  assert.equal(f1.name, 'status')
  assert.equal(f1.type, 'string')
  assert.equal(f1.required, true)

  const f2 = parseFieldSpec('count', 'int')
  assert.equal(f2.name, 'count')
  assert.equal(f2.type, 'int')
  assert.equal(f2.required, false)

  // Aliases
  assert.equal(parseFieldSpec('active:boolean!').type, 'bool')
  assert.equal(parseFieldSpec('views:integer').type, 'int')
  assert.equal(parseFieldSpec('large:bigint').type, 'int')
  assert.equal(parseFieldSpec('created:timestamp').type, 'time')
  assert.equal(parseFieldSpec('data:jsonb').type, 'json')
  assert.equal(parseFieldSpec('payload:blob').type, 'bytes')

  // New types
  assert.equal(parseFieldSpec('meta:json').type, 'json')
  assert.equal(parseFieldSpec('ext_id:uuid').type, 'uuid')
  assert.equal(parseFieldSpec('bin:bytes').type, 'bytes')
  assert.equal(parseFieldSpec('published:date').type, 'date')

  // Ref with target
  const fRef = parseFieldSpec('project:ref:projects!')
  assert.equal(fRef.name, 'project_id')
  assert.equal(fRef.type, 'ref')
  assert.equal(fRef.target, 'projects')
  assert.equal(fRef.required, true)

  // Custom raw SQL fallback
  const fCustom = parseFieldSpec('score:numeric(10,2)')
  assert.equal(fCustom.name, 'score')
  assert.equal(fCustom.t.sqlite, 'numeric(10,2)')
})

test('findTable resolves exact and inflected table names', () => {
  const dir = setupMockProject()
  try {
    assert.equal(findTable(dir, 'notes'), 'notes')
    assert.equal(findTable(dir, 'note'), 'notes')
    assert.throws(() => findTable(dir, 'unknown'), /not found/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspectTable parses columns from migrations without including goose down', () => {
  const dir = setupMockProject()
  try {
    const { columns } = inspectTable(dir, 'notes')
    assert.equal(columns.has('id'), true)
    assert.equal(columns.has('title'), true)
    assert.equal(columns.has('body'), true)
    assert.equal(columns.has('pinned'), true)
    assert.equal(columns.has('created_at'), true)
    assert.equal(columns.has('updated_at'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateQueries modifies INSERT and UPDATE correctly', () => {
  const initial = `INSERT INTO notes (id, title, created_at, updated_at) VALUES (@id, @title, @now, @now);\nUPDATE notes SET title = @title, updated_at = @now WHERE id = @id;`

  const added = updateQueries(initial, 'notes', 'addColumn', { name: 'status' })
  assert.equal(added.includes('id, title, status, created_at'), true)
  assert.equal(added.includes('@id, @title, @status, @now'), true)
  assert.equal(added.includes('status = @status, updated_at = @now'), true)

  const renamed = updateQueries(added, 'notes', 'renameColumn', { oldName: 'status', newName: 'state' })
  assert.equal(renamed.includes('state'), true)
  assert.equal(renamed.includes('status'), false)

  const removed = updateQueries(renamed, 'notes', 'removeColumn', { name: 'state' })
  assert.equal(removed.includes('state'), false)
})

test('planModdb addColumn generates valid migrations and updates queries', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planModdb(p, 'addColumn', ['notes', 'status:string!'])
    assert.equal(planned.files.length >= 2, true)
    const sqlFile = planned.files.find((f) => f.path.includes('00002_add_status_to_notes.sql'))
    assert.ok(sqlFile)
    assert.equal(sqlFile.content.includes('ALTER TABLE notes ADD COLUMN status'), true)
    assert.equal(sqlFile.content.includes('ALTER TABLE notes DROP COLUMN status'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planModdb changeType requires --force', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    assert.throws(
      () => planModdb(p, 'changeType', ['notes', 'pinned:int'], { force: false }),
      /changeType requires --force/
    )

    const planned = planModdb(p, 'changeType', ['notes', 'pinned:int'], { force: true })
    const pgFile = planned.files.find((f) => f.path.includes('postgres') && f.path.includes('change_pinned_type'))
    assert.ok(pgFile)
    assert.equal(pgFile.content.includes('ALTER TABLE notes ALTER COLUMN pinned TYPE BIGINT'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planModdb renameColumn and renameColum work identically', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const p1 = planModdb(p, 'renameColumn', ['notes', 'title', 'heading'])
    const p2 = planModdb(p, 'renameColum', ['notes', 'title', 'heading'])
    assert.equal(p1.files[0].content, p2.files[0].content)
    assert.equal(p1.files[0].content.includes('ALTER TABLE notes RENAME COLUMN title TO heading'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planModdb removeColumn creates drop migration and preserves down add', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planModdb(p, 'removeColumn', ['notes', 'pinned'])
    const sqlFile = planned.files.find((f) => f.path.includes('sqlite') && f.path.includes('remove_pinned_from_notes'))
    assert.ok(sqlFile)
    assert.equal(sqlFile.content.includes('ALTER TABLE notes DROP COLUMN pinned'), true)
    assert.equal(sqlFile.content.includes('ALTER TABLE notes ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT 0'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseExistingDTO, inferFieldType, moldHandler, planDTO } from './dto.mjs'

function setupMockProject() {
  const dir = mkdtempSync(join(tmpdir(), 'dto-test-'))
  mkdirSync(join(dir, 'gateway/internal/store/migrations/sqlite'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/store/migrations/postgres'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/store/queries'), { recursive: true })
  mkdirSync(join(dir, 'gateway/internal/server'), { recursive: true })
  mkdirSync(join(dir, 'web'), { recursive: true })

  writeFileSync(join(dir, 'gateway/go.mod'), 'module github.com/test/app/gateway\n\ngo 1.26\n')
  writeFileSync(join(dir, 'web/package.json'), '{"name": "test-web"}\n')

  const sqlite00001 = `-- +goose Up
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    internal_note TEXT NOT NULL DEFAULT '',
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL
);

-- +goose Down
DROP TABLE users;
`
  const handler = `package server

import (
	"context"
	"net/http"
	"time"
	"github.com/test/app/gateway/internal/store/db"
)

// openapi:schema User
// type: object
// required: [id, username, email, password_hash, role, internal_note, created_at, updated_at]
// properties:
//   id: { type: string, format: uuid }
//   username: { type: string }
//   email: { type: string }
//   password_hash: { type: string }
//   role: { type: string }
//   internal_note: { type: string }
//   created_at: { type: string, format: date-time }
//   updated_at: { type: string, format: date-time }

type userDTO struct {
	ID           string    \`json:"id"\`
	Username     string    \`json:"username"\`
	Email        string    \`json:"email"\`
	PasswordHash string    \`json:"password_hash"\`
	Role         string    \`json:"role"\`
	InternalNote string    \`json:"internal_note"\`
	CreatedAt    time.Time \`json:"created_at"\`
	UpdatedAt    time.Time \`json:"updated_at"\`
}

func toUser(x db.User) userDTO {
	return userDTO{ID: x.ID, Username: x.Username, Email: x.Email, PasswordHash: x.PasswordHash, Role: x.Role, InternalNote: x.InternalNote, CreatedAt: x.CreatedAt.UTC(), UpdatedAt: x.UpdatedAt.UTC()}
}
`

  writeFileSync(join(dir, 'gateway/internal/store/migrations/sqlite/00001_init.sql'), sqlite00001)
  writeFileSync(join(dir, 'gateway/internal/server/users.go'), handler)

  return dir
}

test('parseExistingDTO extracts schema, struct, and toX mapper', () => {
  const code = `
// openapi:schema Task
// properties:
//   id: { type: string, format: uuid }
//   title: { type: string }
type taskDTO struct {
	ID    string \`json:"id"\`
	Title string \`json:"title"\`
}
func toTask(x db.Task) taskDTO {
	return taskDTO{ID: x.ID, Title: x.Title}
}
`
  const parsed = parseExistingDTO(code)
  assert.equal(parsed.schemaName, 'Task')
  assert.equal(parsed.dtoname, 'taskDTO')
  assert.equal(parsed.toFuncName, 'toTask')
  assert.equal(parsed.dbModelName, 'Task')
  assert.equal(parsed.fields.has('id'), true)
  assert.equal(parsed.fields.has('title'), true)
})

test('inferFieldType accurately identifies primitives and formats', () => {
  assert.equal(inferFieldType('id', 'TEXT PRIMARY KEY').schema.includes('uuid'), true)
  assert.equal(inferFieldType('count', 'INTEGER').goType, 'int64')
  assert.equal(inferFieldType('done', 'BOOLEAN').goType, 'bool')
  assert.equal(inferFieldType('rate', 'REAL').goType, 'float64')
  assert.equal(inferFieldType('meta', 'JSONB').goType, 'string')
})

test('moldHandler shapes DTO removing sensitive leaked fields', () => {
  const dir = setupMockProject()
  try {
    const handlerPath = join(dir, 'gateway/internal/server/users.go')
    const code = readFileSync(handlerPath, 'utf8')
    const tableInfo = {
      columns: new Map([
        ['id', { sqliteDef: 'TEXT PRIMARY KEY' }],
        ['username', { sqliteDef: 'TEXT NOT NULL' }],
        ['email', { sqliteDef: 'TEXT NOT NULL' }],
        ['password_hash', { sqliteDef: 'TEXT NOT NULL' }],
        ['role', { sqliteDef: 'TEXT NOT NULL' }],
        ['internal_note', { sqliteDef: 'TEXT NOT NULL' }],
        ['created_at', { sqliteDef: 'DATETIME NOT NULL' }],
        ['updated_at', { sqliteDef: 'DATETIME NOT NULL' }],
      ]),
    }

    // Exclude password_hash and internal_note
    const safeCols = new Set(['id', 'username', 'email', 'role', 'created_at', 'updated_at'])
    const molded = moldHandler(code, tableInfo, safeCols)

    assert.equal(molded.includes('PasswordHash'), false)
    assert.equal(molded.includes('password_hash'), false)
    assert.equal(molded.includes('InternalNote'), false)
    assert.equal(molded.includes('internal_note'), false)
    assert.equal(molded.includes('Username'), true)
    assert.equal(molded.includes('Email'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planDTO inspectOnly returns exposed vs hidden comparison', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planDTO(p, 'users', [])
    assert.equal(planned.inspectOnly, true)
    assert.equal(planned.schemaName, 'User')
    assert.equal(planned.currentDTOCols.includes('password_hash'), true)
    assert.equal(planned.hiddenCols.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planDTO with --omit prevents leaks and updates file', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planDTO(p, 'users', [], { omit: 'password_hash,internal_note' })
    assert.equal(planned.inspectOnly, false)
    assert.equal(planned.exposed.includes('password_hash'), false)
    assert.equal(planned.hidden.includes('password_hash'), true)
    assert.equal(planned.hidden.includes('internal_note'), true)

    const updated = planned.files[0].content
    assert.equal(updated.includes('password_hash'), false)
    assert.equal(updated.includes('internal_note'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planDTO fails on empty DTO', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    assert.throws(
      () => planDTO(p, 'users', [], { only: '' }),
      /cannot have an empty DTO/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

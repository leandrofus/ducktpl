import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, configure, TENANTS } from './features.mjs'
import { scaffold, names } from './scaffold.mjs'

const TEMPLATE = join(new URL('.', import.meta.url).pathname, '..', 'template')

test('TENANTS list contains singleTenant and multitenant', () => {
  assert.equal(TENANTS.length, 2)
  assert.equal(TENANTS[0].id, 'singleTenant')
  assert.equal(TENANTS[1].id, 'multitenant')
})

test('defaults() sets singleTenant: true, multitenant: false', () => {
  const d = defaults()
  assert.equal(d.singleTenant, true)
  assert.equal(d.multitenant, false)
})

test('configure() properly sets tenant mode and normalizes aliases', () => {
  const c1 = configure([], 'react', 'singleTenant')
  assert.equal(c1.singleTenant, true)
  assert.equal(c1.multitenant, false)

  const c2 = configure([], 'react', 'multitenant')
  assert.equal(c2.singleTenant, false)
  assert.equal(c2.multitenant, true)

  const c3 = configure([], 'react', 'single-tenant')
  assert.equal(c3.singleTenant, true)

  const c4 = configure([], 'react', 'multi-tenant')
  assert.equal(c4.multitenant, true)

  assert.throws(() => configure([], 'react', 'invalidTenant'), /unknown tenant\/RLS option/)
})

test('scaffolding with singleTenant omits tenant.go and rls policies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rls-test-'))
  try {
    const cfg = configure([], 'react', 'singleTenant')
    const n = names('testapp', 'duckowner')
    scaffold(TEMPLATE, dir, cfg, n)

    assert.equal(existsSync(join(dir, 'gateway/internal/store/tenant.go')), false)

    const initSqlite = readFileSync(join(dir, 'gateway/internal/store/migrations/sqlite/00001_init.sql'), 'utf8')
    assert.equal(initSqlite.includes('tenant_id'), false)

    const initPg = readFileSync(join(dir, 'gateway/internal/store/migrations/postgres/00001_init.sql'), 'utf8')
    assert.equal(initPg.includes('ENABLE ROW LEVEL SECURITY'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffolding with multitenant includes tenant.go and RLS in postgres migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rls-test-'))
  try {
    const cfg = configure([], 'react', 'multitenant')
    const n = names('testapp', 'duckowner')
    scaffold(TEMPLATE, dir, cfg, n)

    assert.equal(existsSync(join(dir, 'gateway/internal/store/tenant.go')), true)

    const initSqlite = readFileSync(join(dir, 'gateway/internal/store/migrations/sqlite/00001_init.sql'), 'utf8')
    assert.equal(initSqlite.includes('tenant_id'), true)

    const initPg = readFileSync(join(dir, 'gateway/internal/store/migrations/postgres/00001_init.sql'), 'utf8')
    assert.equal(initPg.includes('ENABLE ROW LEVEL SECURITY'), true)
    assert.equal(initPg.includes('CREATE POLICY notes_tenant_isolation ON notes'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

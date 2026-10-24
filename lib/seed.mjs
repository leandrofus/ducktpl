// seed.mjs: generates realistic mock seed data for create-duck projects.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspectTable, liveTables } from './moddb.mjs'
import { singularize } from './generate.mjs'

const SYSTEM_TABLES = new Set([
  'goose_db_version',
  'sessions',
  'audit_log',
  'audit_events',
  'roles',
  'role_permissions',
  'permissions',
  'users',
])

export function discoverTables(root) {
  if (!existsSync(join(root, 'gateway/internal/store/migrations/sqlite'))) return []
  return [...liveTables(root)].filter((t) => !SYSTEM_TABLES.has(t))
}

/**
 * What the handler's check function accepts, read from its error messages
 * (enum, length, range): a seed that breaks them makes the API answer 400 or 500
 * when it reads the rows back.
 */
export function constraintsOf(root, table) {
  const dir = join(root, 'gateway/internal/server')
  const file = [table, singularize(table)].map((n) => join(dir, `${n}.go`)).find((f) => existsSync(f))
  const out = {}
  if (!file) return out
  const text = readFileSync(file, 'utf8')
  const of = (col) => (out[col] ||= {})
  for (const m of text.matchAll(/"(\w+) must be one of: ([^"]+)"/g)) of(m[1]).enum = m[2].split(',').map((v) => v.trim())
  for (const m of text.matchAll(/"(\w+) must have at least (\d+) characters"/g)) of(m[1]).minLen = +m[2]
  for (const m of text.matchAll(/"(\w+) must have at most (\d+) characters"/g)) of(m[1]).maxLen = +m[2]
  for (const m of text.matchAll(/"(\w+) must be at least (-?[\d.]+)"/g)) of(m[1]).min = +m[2]
  for (const m of text.matchAll(/"(\w+) must be at most (-?[\d.]+)"/g)) of(m[1]).max = +m[2]
  return out
}

/** Makes a SQL literal respect the column's constraints. */
function fit(literal, c) {
  if (!c) return literal
  if (literal.startsWith("'")) {
    let v = literal.slice(1, -1)
    if (c.maxLen !== undefined) v = v.slice(0, c.maxLen)
    while (c.minLen !== undefined && v.length < c.minLen) v += ' lorem ipsum'.slice(0, c.minLen - v.length)
    return `'${v}'`
  }
  let n = Number(literal)
  if (Number.isNaN(n)) return literal
  if (c.min !== undefined) n = Math.max(n, c.min)
  if (c.max !== undefined) n = Math.min(n, c.max)
  return String(n)
}

function fakeValue(colName, colType, idx, tableRefs, table = '', c) {
  if (c?.enum?.length) return `'${c.enum[idx % c.enum.length]}'`
  return fit(rawValue(colName, colType, idx, tableRefs, table), c)
}

function rawValue(colName, colType, idx, tableRefs, table) {
  const name = colName.toLowerCase()
  const type = (colType || '').toUpperCase()

  if (name.endsWith('_id') || name === 'ref') {
    const parent = name.replace(/_id$/, '')
    const candidates = tableRefs.get(parent) || tableRefs.get(parent + 's') || tableRefs.get(parent + 'es')
    if (candidates && candidates.length) {
      return `'${candidates[idx % candidates.length]}'`
    }
    return `'018e3d82-82c5-7b24-bc64-${String(idx + 1).padStart(12, '0')}'`
  }

  if (name === 'id') {
    return `'018e3d82-82c5-7b24-bc64-${String(idx + 1).padStart(12, '0')}'`
  }
  if (name === 'created_at' || name === 'updated_at' || name.endsWith('_at') || type.includes('DATE') || type.includes('TIME')) {
    return `'2026-10-24T12:00:00Z'`
  }
  if (name.includes('email')) {
    return `'user${idx + 1}@example.com'`
  }
  if (name.includes('phone') || name.includes('tel')) {
    return `'+1-555-010${idx + 1}'`
  }
  if (name === 'status') {
    const statuses = ['scheduled', 'active', 'pending', 'completed']
    return `'${statuses[idx % statuses.length]}'`
  }
  if (name === 'name' || name === 'full_name') {
    const names = ['Clinica Central', 'Veterinaria Norte', 'Juan Perez', 'Maria Garcia', 'Firulais', 'Luna', 'Rocky']
    return `'${names[idx % names.length]}'`
  }
  if (name === 'title') {
    const titles = ['Consulta General', 'Vacunacion', 'Control Anual', 'Cirugia Menor', 'Revision Dental']
    return `'${titles[idx % titles.length]}'`
  }
  if (name === 'reason' || name === 'notes' || name === 'description' || name === 'address' || name === 'bio' || name === 'body') {
    return `'Mock notes and description for item ${idx + 1}'`
  }
  if (name === 'species') {
    const species = ['Canino', 'Felino', 'Ave', 'Exotico']
    return `'${species[idx % species.length]}'`
  }
  if (name === 'breed') {
    const breeds = ['Labrador', 'Siames', 'Pastor Aleman', 'Golden', 'Caniche']
    return `'${breeds[idx % breeds.length]}'`
  }
  if (type.includes('INT')) {
    return `${(idx + 1) * 10}`
  }
  if (type.includes('REAL') || type.includes('DOUBLE') || type.includes('FLOAT') || type.includes('NUMERIC')) {
    return `${(idx + 1) * 15.5}`
  }
  if (type.includes('BOOL')) {
    return `${idx % 2 === 0 ? 1 : 0}`
  }
  if (/url|avatar|photo|image|picture/.test(name)) {
    return `'https://picsum.photos/seed/${table}${idx + 1}/600/400'`
  }
  const words = name.replace(/_id$/, '').replace(/_/g, ' ')
  return `'${words[0].toUpperCase() + words.slice(1)} ${idx + 1}'`
}

export function planSeed(p, count = 5, opts = {}) {
  const tables = discoverTables(p.root)
  if (!tables.length) {
    throw new Error('no user resource tables found to seed')
  }

  const tableRefs = new Map() // tableName -> array of IDs
  const statements = []
  const seeded = []
  let totalRecords = 0

  for (const tbl of tables) {
    let colDefs
    try {
      const info = inspectTable(p.root, tbl)
      colDefs = info.columns
    } catch {
      continue
    }

    const cols = [...colDefs.keys()]
    if (!cols.length) continue
    const cons = constraintsOf(p.root, tbl)

    const ids = []
    for (let i = 0; i < count; i++) {
      const id = `018e3d82-82c5-7b24-${String(tables.indexOf(tbl) + 1).padStart(4, '0')}-${String(i + 1).padStart(12, '0')}`
      ids.push(id)
      const values = cols.map((c) => {
        if (c.toLowerCase() === 'id') return `'${id}'`
        const colMeta = colDefs.get(c)
        return fakeValue(c, colMeta?.sqliteType, i, tableRefs, tbl, cons[c])
      })

      statements.push(`INSERT OR IGNORE INTO ${tbl} (${cols.join(', ')}) VALUES (${values.join(', ')});`)
      totalRecords++
    }

    tableRefs.set(tbl, ids)
    seeded.push({ table: tbl, count })
  }

  const sqlContent = `-- seed.sql generated by ducktpl seed\n-- Run: sqlite3 <db> < seed.sql\n\n` + statements.join('\n') + '\n'
  const outPath = 'gateway/internal/store/seed.sql'

  return {
    status: 'ok',
    action: 'seed',
    count,
    tables: seeded,
    totalRecords,
    file: { path: outPath, content: sqlContent },
  }
}

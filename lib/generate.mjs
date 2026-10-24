// ducktpl add: adds a resource to a project made with create-duck, through
// every layer of the add-an-endpoint loop (CLAUDE.md):
//
//   migration (both engines) → queries → handler with its OpenAPI blocks →
//   route → permissions (auth, rbac) → HTTP test → web page + nav
//
// It reads the project to know which modules it has, writes new files and
// inserts lines at the `ducktpl:<place>` anchors the template left behind.
//
// Scopes are containers: addScope makes a resource others can live in, and
// addToScope makes a resource that lives in one (a required ref to it, a
// nested list route, a scope picker on its page). Access stays per object:
// being able to see a project does not show its tasks.
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// go: Go type; null: its sqlc type when the column is nullable (optional
// time and ref fields; the other types use a default instead).
export const TYPES = {
  string: { go: 'string', sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''", schema: '{ type: string }', ts: 'string', sample: '"example"', other: '"changed"', empty: "''" },
  text: { go: 'string', sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''", schema: '{ type: string }', ts: 'string', sample: '"some text"', other: '"other text"', empty: "''" },
  int: { go: 'int64', sqlite: 'INTEGER NOT NULL DEFAULT 0', pg: 'BIGINT NOT NULL DEFAULT 0', schema: '{ type: integer, format: int64 }', ts: 'number', sample: '42', other: '7', empty: '0' },
  float: { go: 'float64', sqlite: 'REAL NOT NULL DEFAULT 0', pg: 'DOUBLE PRECISION NOT NULL DEFAULT 0', schema: '{ type: number, format: double }', ts: 'number', sample: '1.5', other: '2.5', empty: '0' },
  bool: { go: 'bool', sqlite: 'BOOLEAN NOT NULL DEFAULT 0', pg: 'BOOLEAN NOT NULL DEFAULT false', schema: '{ type: boolean }', ts: 'boolean', sample: 'true', other: 'false', empty: 'false' },
  time: { go: 'time.Time', null: 'sql.NullTime', ptr: 'timePtr', fromPtr: 'nullTime', sqlite: 'DATETIME', pg: 'TIMESTAMPTZ', format: 'date-time', ts: 'string', sample: '"2026-01-02T15:04:05Z"' },
  date: { go: 'string', sqlite: "TEXT NOT NULL DEFAULT ''", pg: "DATE NOT NULL DEFAULT CURRENT_DATE", format: 'date', schema: '{ type: string, format: date }', ts: 'string', sample: '"2026-01-02"', other: '"2026-01-03"', empty: "''" },
  json: { go: 'string', sqlite: "TEXT NOT NULL DEFAULT '{}'", pg: "JSONB NOT NULL DEFAULT '{}'", schema: '{ type: object }', ts: 'Record<string, unknown>', sample: '"{}"', other: '"{\\"a\\":1}"', empty: '"{}"' },
  uuid: { go: 'string', sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''", format: 'uuid', schema: '{ type: string, format: uuid }', ts: 'string', sample: '"018e3d82-82c5-7b24-bc64-16cf9b78a999"', other: '"018e3d82-82c5-7b24-bc64-16cf9b78aaaa"', empty: "''" },
  bytes: { go: '[]byte', sqlite: "BLOB NOT NULL DEFAULT (x'')", pg: "BYTEA NOT NULL DEFAULT '\\x'", schema: '{ type: string, format: binary }', ts: 'string', sample: '""', other: '"abc"', empty: 'nil' },
  ref: { go: 'string', null: 'sql.NullString', ptr: 'strPtr', fromPtr: 'nullStr', sqlite: 'TEXT', pg: 'TEXT', format: 'uuid', ts: 'string' },
}

export const TYPE_ALIASES = {
  boolean: 'bool',
  integer: 'int',
  bigint: 'int',
  int64: 'int',
  int32: 'int',
  number: 'float',
  double: 'float',
  real: 'float',
  timestamp: 'time',
  datetime: 'time',
  blob: 'bytes',
  jsonb: 'json',
  varchar: 'string',
}

const RESERVED = new Set(['id', 'created_at', 'updated_at'])

// ---- names ----

const pascal = (snake) => snake.split('_').map((w) => (w === 'id' ? 'ID' : w[0].toUpperCase() + w.slice(1))).join('')
const camel = (snake) => {
  const p = pascal(snake)
  return p[0].toLowerCase() + p.slice(1)
}
const snake = (Pascal) => Pascal.replace(/ID$/, 'Id').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** English singular, close to what sqlc (jinzhu/inflection) does for table names. */
export function singularize(w) {
  if (/ies$/.test(w)) return w.replace(/ies$/, 'y')
  if (/(ss|x|z|ch|sh)es$/.test(w)) return w.replace(/es$/, '')
  if (/ses$/.test(w)) return w.replace(/es$/, '')
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1)
  return w
}

function names(plural, singular) {
  const words = plural.replace(/_/g, ' ')
  return {
    table: plural, // work_items
    one: singular, // work_item: object type, events, cache keys
    url: '/' + plural.replace(/_/g, '-'), // /work-items
    Plural: pascal(plural), // WorkItems
    Singular: pascal(singular), // WorkItem: DTO, sqlc model
    label: words[0].toUpperCase() + words.slice(1), // Work items
    one_label: singular.replace(/_/g, ' '), // work item
  }
}

export function resourceNames(plural, singular) {
  if (!/^[a-z][a-z0-9_]*$/.test(plural)) throw new Error(`resource "${plural}": lowercase letters, digits and underscores (e.g. tasks, work_items)`)
  singular ||= singularize(plural)
  if (singular === plural) throw new Error(`cannot tell the singular of "${plural}": pass --singular`)
  return names(plural, singular)
}

export function parseSingleField(spec) {
  const parts = spec.split(':')
  if (parts.length < 2) {
    throw new Error(`field "${spec}": write name:type, with ! for required (types: ${Object.keys(TYPES).join(', ')}; refs: name:ref:<resource>)`)
  }

  const namePart = parts[0]
  if (!/^[a-z][a-z0-9_]*$/.test(namePart)) {
    throw new Error(`field "${spec}": invalid field name "${namePart}" (must be lowercase alphanumeric + underscores)`)
  }

  let typeToken = parts[1]
  let required = false
  let target = null
  let unique = false
  let index = false
  let defaultValue = undefined
  let enumValues = null
  let minVal = undefined
  let maxVal = undefined

  let nextIdx = 2
  if (typeToken === 'ref') {
    if (parts.length < 3) {
      throw new Error(`field "${spec}": which resource? e.g. ${namePart}:ref:projects`)
    }
    target = parts[2]
    if (target.endsWith('!')) {
      required = true
      target = target.slice(0, -1)
    }
    nextIdx = 3
  } else {
    if (typeToken.endsWith('!')) {
      required = true
      typeToken = typeToken.slice(0, -1)
    }
  }

  let rawType = typeToken
  let type = TYPE_ALIASES[rawType] || rawType
  if (!TYPES[type]) {
    throw new Error(`field "${spec}": unknown type ${type} (${Object.keys(TYPES).join(', ')})`)
  }

  for (let i = nextIdx; i < parts.length; i++) {
    let mod = parts[i]
    if (mod.endsWith('!')) {
      required = true
      mod = mod.slice(0, -1)
    }
    if (mod === 'unique') {
      unique = true
    } else if (mod === 'index') {
      index = true
    } else if (/^default\((.*)\)$/.test(mod)) {
      defaultValue = /^default\((.*)\)$/.exec(mod)[1]
    } else if (/^enum\((.*)\)$/.test(mod)) {
      enumValues = /^enum\((.*)\)$/.exec(mod)[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      if (defaultValue === undefined && enumValues.length) {
        defaultValue = enumValues[0]
      }
    } else if (/^min\((.*)\)$/.test(mod)) {
      minVal = Number(/^min\((.*)\)$/.exec(mod)[1].trim())
    } else if (/^max\((.*)\)$/.test(mod)) {
      maxVal = Number(/^max\((.*)\)$/.exec(mod)[1].trim())
    } else if (mod === '') {
      continue
    } else {
      throw new Error(`field "${spec}": unknown modifier "${mod}" (valid: unique, index, default(...), enum(...), min(...), max(...))`)
    }
  }

  let finalName = namePart
  if (type === 'ref' && !finalName.endsWith('_id')) finalName += '_id'
  if (RESERVED.has(finalName)) throw new Error(`field "${finalName}" is added for you`)

  return {
    name: finalName,
    type,
    required,
    target,
    unique,
    index,
    defaultValue,
    enumValues,
    minVal,
    maxVal,
    t: TYPES[type],
    Go: pascal(finalName),
    nullable: !required && !enumValues && !!TYPES[type].null,
  }
}

/**
 * name:type[!], and name:ref:<resource>[!] for a reference to another
 * resource (the column gets an _id suffix: project:ref:projects → project_id).
 * Modifiers: :unique, :index, :default(<value>)
 * plan() checks there is at least one.
 */
export function parseFields(specs) {
  const seen = new Set()
  return specs.map((spec) => {
    const f = parseSingleField(spec)
    if (seen.has(f.name)) throw new Error(`field "${f.name}" twice`)
    seen.add(f.name)
    return f
  })
}

const label = (name) => {
  const s = name.replace(/_id$/, '').replace(/_/g, ' ')
  return s[0].toUpperCase() + s.slice(1)
}

// ---- the project ----

export function findProject(start) {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'gateway', 'go.mod')) && existsSync(join(dir, 'web', 'package.json'))) return dir
    const up = join(dir, '..')
    if (up === dir) throw new Error('not inside a create-duck project (no gateway/go.mod and web/package.json above here)')
    dir = up
  }
}

export function inspect(root) {
  const gw = join(root, 'gateway')
  const mod = /^module\s+(\S+)/m.exec(readFileSync(join(gw, 'go.mod'), 'utf8'))[1]
  const has = (p) => existsSync(join(root, p))
  return {
    root,
    module: mod,
    auth: has('gateway/internal/auth/perms.go'),
    rbac: has('gateway/internal/server/rbac.go'),
    live: has('web/src/lib/live.ts'),
    multitenant: has('gateway/internal/store/tenant.go'),
  }
}

function nextMigration(root, extraFiles = []) {
  const dir = join(root, 'gateway/internal/store/migrations/sqlite')
  const diskNums = existsSync(dir) ? readdirSync(dir).map((f) => parseInt(f, 10)).filter((n) => !isNaN(n)) : []
  const extraNums = extraFiles.map((f) => parseInt(f.split('/').pop(), 10)).filter((n) => !isNaN(n))
  const nums = [...diskNums, ...extraNums]
  return String(Math.max(0, ...nums) + 1).padStart(5, '0')
}

const read = (root, path) => readFileSync(join(root, path), 'utf8')
const goFiles = (root, test) =>
  readdirSync(join(root, 'gateway/internal/server'))
    .filter((f) => f.endsWith('.go') && f.endsWith('_test.go') === test)
    .map((f) => 'gateway/internal/server/' + f)

/**
 * What a ref field needs to know about the resource it points to: its
 * names (from its queries), the column the UI shows for it (its first text
 * column), its test seed helper and the handler with its delete anchors.
 */
function target(p, table) {
  const qpath = `gateway/internal/store/queries/${table}.sql`
  const fileExists = (rel) => (p.existsSync ? p.existsSync(rel) : existsSync(join(p.root, rel)))
  const getFile = (rel) => (p.readFile ? p.readFile(rel) : read(p.root, rel))

  if (!fileExists(qpath)) throw new Error(`ref to "${table}": no ${qpath} (add that resource first)`)
  const get = new RegExp(`-- name: Get(\\w+) :one\\s*\\nSELECT \\* FROM ${table} WHERE id = `).exec(getFile(qpath))
  if (!get) throw new Error(`ref to "${table}": ${qpath} has no Get…(id) query`)
  const n = names(table, snake(get[1]))
  n.Singular = get[1]
  let show = 'id'
  const dir = 'gateway/internal/store/migrations/sqlite'
  const migrationFiles = p.listMigrations ? p.listMigrations(dir) : (existsSync(join(p.root, dir)) ? readdirSync(join(p.root, dir)).sort() : [])
  for (const f of migrationFiles) {
    const text = getFile(`${dir}/${f}`)
    const m = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`).exec(text)
    if (!m) continue
    const col = m[1].split('\n').map((l) => /^\s*([a-z][a-z0-9_]*)\s+TEXT\b/.exec(l)?.[1]).find((c) => c && c !== 'id' && !c.endsWith('_id'))
    if (col) show = col
    break
  }
  n.show = show
  n.seed = `seed${n.Singular}`
  const ownTestFile = `gateway/internal/server/${table}_test.go`
  const stTestFile = `gateway/internal/server/server_test.go`
  const hasSeedInOwn = fileExists(ownTestFile) && getFile(ownTestFile).includes(`func ${n.seed}(`)
  const hasSeedInSt = fileExists(stTestFile) && getFile(stTestFile).includes(`func ${n.seed}(`)
  if (!hasSeedInOwn && !hasSeedInSt) {
    n.seedMissing = true
  }
  const handlerFiles = existsSync(join(p.root, 'gateway/internal/server')) ? goFiles(p.root, false) : []
  n.handler = handlerFiles.find((f) => new RegExp(`// ducktpl:on-delete ${n.one}\\b`).test(getFile(f)))
  return n
}

// ---- generated code ----

const colType = (engine, x) => {
  let base
  if (x.type === 'ref') {
    base = x.required ? `TEXT NOT NULL REFERENCES ${x.ref.table} (id) ON DELETE CASCADE` : `TEXT REFERENCES ${x.ref.table} (id) ON DELETE SET NULL`
  } else if (x.type === 'time') {
    base = x.t[engine] + (x.required ? ' NOT NULL' : '')
  } else if (x.defaultValue !== undefined) {
    const rawSql = x.t[engine]
    const def = (x.type === 'string' || x.type === 'text') ? `'${x.defaultValue}'` : x.defaultValue
    const notNull = x.required ? ' NOT NULL' : ''
    const typeOnly = rawSql.replace(/DEFAULT\s+[^,;\s]+/, '').replace(/NOT\s+NULL/, '').trim()
    base = `${typeOnly}${notNull} DEFAULT ${def}`
  } else {
    base = x.t[engine]
  }

  if (x.unique) base += ' UNIQUE'
  return base
}

function migration(engine, n, f, p) {
  const ts = engine === 'pg' ? 'TIMESTAMPTZ' : 'DATETIME'
  const w = Math.max(10, ...f.map((x) => x.name.length))
  let tenantCol = ''
  let tenantIndex = ''
  let tenantRls = ''
  let tenantDown = ''
  if (p.multitenant) {
    if (engine === 'pg') {
      tenantCol = `    ${'tenant_id'.padEnd(w)} TEXT NOT NULL DEFAULT current_setting('app.current_tenant', true),\n`
      tenantIndex = `CREATE INDEX ${n.table}_tenant_id ON ${n.table} (tenant_id);\n`
      tenantRls = `ALTER TABLE ${n.table} ENABLE ROW LEVEL SECURITY;\n` +
        `CREATE POLICY ${n.table}_tenant_isolation ON ${n.table}\n` +
        `    USING (tenant_id = current_setting('app.current_tenant', true))\n` +
        `    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));\n`
      tenantDown = `DROP POLICY IF EXISTS ${n.table}_tenant_isolation ON ${n.table};\n`
    } else {
      tenantCol = `    ${'tenant_id'.padEnd(w)} TEXT NOT NULL DEFAULT '',\n`
      tenantIndex = `CREATE INDEX ${n.table}_tenant_id ON ${n.table} (tenant_id);\n`
    }
  }
  const cols = f.map((x) => `    ${x.name.padEnd(w)} ${colType(engine, x)},`).join('\n')
  let up = `-- +goose Up
CREATE TABLE ${n.table} (
    ${'id'.padEnd(w)} TEXT PRIMARY KEY,
${tenantCol}${cols}
    ${'created_at'.padEnd(w)} ${ts} NOT NULL,
    ${'updated_at'.padEnd(w)} ${ts} NOT NULL
);
${f.filter((x) => x.ref || x.index).map((x) => `CREATE INDEX ${n.table}_${x.name} ON ${n.table} (${x.name});\n`).join('')}${tenantIndex}${tenantRls}`
  let down = `${tenantDown}DROP TABLE ${n.table};\n`
  if (p.rbac) {
    // existing databases: the builtin user role gets the new permissions too
    up += `UPDATE roles SET permissions = permissions || ' ${n.table}.read ${n.table}.write' WHERE name = 'user';\n`
    down = `UPDATE roles SET permissions = replace(permissions, ' ${n.table}.read ${n.table}.write', '') WHERE name = 'user';\n` + down
  }
  return `${up}\n-- +goose Down\n${down}`
}

const grantsQuery = (n, x) => `Delete${n.Singular}GrantsBy${pascal(x.name.replace(/_id$/, ''))}`

function queries(n, f, p, scope) {
  const cols = f.map((x) => x.name)
  let s = `-- name: Count${n.Plural} :one
SELECT count(*) FROM ${n.table};

-- name: List${n.Plural} :many
SELECT * FROM ${n.table} ORDER BY updated_at DESC LIMIT CAST(@lim_count AS BIGINT) OFFSET CAST(@lim_offset AS BIGINT);

-- name: Get${n.Singular} :one
SELECT * FROM ${n.table} WHERE id = @id;

-- name: Create${n.Singular} :exec
INSERT INTO ${n.table} (id, ${cols.join(', ')}, created_at, updated_at)
VALUES (@id, ${cols.map((c) => '@' + c).join(', ')}, @now, @now);

-- name: Update${n.Singular} :exec
UPDATE ${n.table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @now WHERE id = @id;

-- name: Delete${n.Singular} :execrows
DELETE FROM ${n.table} WHERE id = @id;
`
  if (scope) {
    s += `
-- name: Count${n.Plural}By${scope.ref.Singular} :one
SELECT count(*) FROM ${n.table} WHERE ${scope.name} = @${scope.name};

-- name: List${n.Plural}By${scope.ref.Singular} :many
SELECT * FROM ${n.table} WHERE ${scope.name} = @${scope.name} ORDER BY updated_at DESC LIMIT CAST(@lim_count AS BIGINT) OFFSET CAST(@lim_offset AS BIGINT);
`
  }
  if (p.rbac) {
    // what a cascade deletes takes its grants along
    for (const x of f.filter((x) => x.ref && x.required)) {
      s += `
-- name: ${grantsQuery(n, x)} :exec
DELETE FROM grants WHERE object_type = '${n.one}' AND object_id IN (SELECT id FROM ${n.table} WHERE ${x.name} = @${x.name});
`
    }
  }
  return s
}

// Per field, the Go on each side of the API.
const dtoType = (x) => (x.nullable ? '*' + x.t.go : x.t.go)
const toDTO = (x) => (x.nullable ? `${x.t.ptr}(x.${x.Go})` : x.type === 'time' ? `x.${x.Go}.UTC()` : `x.${x.Go}`)
const fromReq = (x) => (x.nullable ? `${x.t.fromPtr}(req.${x.Go})` : `req.${x.Go}`)
const schema = (x) => (
  x.enumValues && x.enumValues.length
    ? `{ type: string, enum: [${x.enumValues.join(', ')}] }`
    : x.t.format
      ? `{ type: ${x.nullable ? "[string, 'null']" : 'string'}, format: ${x.t.format} }`
      : x.t.schema
)
const isText = (x) => x.type === 'string' || x.type === 'text'

function checks(x) {
  const out = []
  if (x.required && isText(x)) out.push(`	if strings.TrimSpace(v.${x.Go}) == "" {\n		return badRequest("${x.name} is required")\n	}`)
  if (x.required && x.type === 'time') out.push(`	if v.${x.Go}.IsZero() {\n		return badRequest("${x.name} is required")\n	}`)
  if (x.enumValues && x.enumValues.length) {
    const list = x.enumValues.map((v) => `"${v}": true`).join(', ')
    const guard = x.required ? `!map[string]bool{${list}}[v.${x.Go}]` : `v.${x.Go} != "" && !map[string]bool{${list}}[v.${x.Go}]`
    out.push(`	if ${guard} {\n		return badRequest("${x.name} must be one of: ${x.enumValues.join(', ')}")\n	}`)
  }
  if (x.minVal !== undefined) {
    if (isText(x)) {
      out.push(`	if len(v.${x.Go}) < ${x.minVal} {\n		return badRequest("${x.name} must have at least ${x.minVal} characters")\n	}`)
    } else if (x.type === 'int' || x.type === 'float') {
      out.push(`	if v.${x.Go} < ${x.minVal} {\n		return badRequest("${x.name} must be at least ${x.minVal}")\n	}`)
    }
  }
  if (x.maxVal !== undefined) {
    if (isText(x)) {
      out.push(`	if len(v.${x.Go}) > ${x.maxVal} {\n		return badRequest("${x.name} must have at most ${x.maxVal} characters")\n	}`)
    } else if (x.type === 'int' || x.type === 'float') {
      out.push(`	if v.${x.Go} > ${x.maxVal} {\n		return badRequest("${x.name} must be at most ${x.maxVal}")\n	}`)
    }
  }
  if (x.type === 'ref' && x.required) {
    out.push(`	if v.${x.Go} == "" {\n		return badRequest("${x.name} is required")\n	}`)
    out.push(`	if _, err := q.Get${x.ref.Singular}(ctx, v.${x.Go}); err != nil {\n		return badRef(err, "${x.ref.one_label}")\n	}`)
  }
  if (x.type === 'ref' && !x.required) {
    out.push(`	if v.${x.Go}.Valid {\n		if _, err := q.Get${x.ref.Singular}(ctx, v.${x.Go}.String); err != nil {\n			return badRef(err, "${x.ref.one_label}")\n		}\n	}`)
  }
  return out
}

function setFromPatch(x) {
  const set = !x.nullable
    ? `v.${x.Go} = req.${x.Go}.V`
    : x.type === 'time'
      ? `v.${x.Go} = sql.NullTime{Time: req.${x.Go}.V, Valid: !req.${x.Go}.Null}`
      : `v.${x.Go} = sql.NullString{String: req.${x.Go}.V, Valid: !req.${x.Go}.Null && req.${x.Go}.V != ""}`
  return `			if req.${x.Go}.Set {\n				${set}\n			}`
}

function handler(n, f, p, o) {
  const S = n.Singular, P = n.Plural, dto = camel(n.one) + 'DTO'
  const df = o.dtoFields || f
  const w = Math.max(...f.map((x) => x.Go.length), 9)
  const pad = (s) => s.padEnd(w)
  const dw = Math.max(...df.map((x) => x.Go.length), 9)
  const dpad = (s) => s.padEnd(dw)
  const tw = Math.max(9, ...f.map((x) => dtoType(x).length))
  const dtw = Math.max(9, ...df.map((x) => dtoType(x).length))
  const required = f.filter((x) => x.required)
  const imports = ['context', ...(f.some((x) => x.nullable) ? ['database/sql'] : []), 'net/http', ...(f.some((x) => x.required && isText(x)) ? ['strings'] : []), 'time']
  const permRead = p.auth ? `auth.Perm${P}Read` : `"${n.table}.read"`
  const permWrite = p.auth ? `auth.Perm${P}Write` : `"${n.table}.write"`
  const sc = o.scopeField
  return `package server

import (
${imports.map((i) => `	"${i}"`).join('\n')}

${p.auth ? `	"${p.module}/internal/auth"\n` : ''}	"${p.module}/internal/store"
	"${p.module}/internal/store/db"
)

// Generated by ducktpl ${o.cmd}. It is yours now: edit freely.
${o.scope ? `// ${n.label} are a scope: other resources live in a ${n.one_label} (ducktpl addToScope ${n.table} …).\n` : ''}
// openapi:schema ${S}
// type: object
// required: [id, ${df.map((x) => x.name).join(', ')}, created_at, updated_at]
// properties:
//   id: { type: string, format: uuid }
${df.map((x) => `//   ${x.name}: ${schema(x)}`).join('\n')}
//   created_at: { type: string, format: date-time }
//   updated_at: { type: string, format: date-time }

type ${dto} struct {
	${dpad('ID')} ${'string'.padEnd(dtw)} \`json:"id"\`
${df.map((x) => `	${dpad(x.Go)} ${dtoType(x).padEnd(dtw)} \`json:"${x.name}"\``).join('\n')}
	${dpad('CreatedAt')} ${'time.Time'.padEnd(dtw)} \`json:"created_at"\`
	${dpad('UpdatedAt')} ${'time.Time'.padEnd(dtw)} \`json:"updated_at"\`
}

func to${S}(x db.${S}) ${dto} {
	return ${dto}{ID: x.ID, ${df.map((x) => `${x.Go}: ${toDTO(x)}`).join(', ')}, CreatedAt: x.CreatedAt.UTC(), UpdatedAt: x.UpdatedAt.UTC()}
}

// openapi:schema Paginated${P}
// type: object
// required: [items, total, page, per_page]
// properties:
//   items: { type: array, items: { $ref: '#/components/schemas/${S}' } }
//   total: { type: integer }
//   page: { type: integer }
//   per_page: { type: integer }

type paginated${P} struct {
	Items   []${dto} \`json:"items"\`
	Total   int      \`json:"total"\`
	Page    int      \`json:"page"\`
	PerPage int      \`json:"per_page"\`
}

// openapi:schema Create${S}Request
// type: object
${required.length ? `// required: [${required.map((x) => x.name).join(', ')}]\n` : ''}// additionalProperties: false
// properties:
${f.map((x) => `//   ${x.name}: ${schema(x)}`).join('\n')}

type create${S}Request struct {
${f.map((x) => `	${pad(x.Go)} ${dtoType(x)} \`json:"${x.name}"\``).join('\n')}
}

// openapi:schema Update${S}Request
// type: object
// additionalProperties: false
// properties:
${f.map((x) => `//   ${x.name}: ${schema(x)}`).join('\n')}

type update${S}Request struct {
${f.map((x) => `	${pad(x.Go)} opt[${x.t.go}] \`json:"${x.name}"\``).join('\n')}
}

// check${S} validates a ${n.one_label} before it is written${f.some((x) => x.ref) ? ', and that what it references exists' : ''}.
func check${S}(ctx context.Context, q *db.Queries, v *db.${S}) error {
${f.flatMap(checks).map((c) => c + '\n').join('')}	return nil
}

// openapi:operation
// summary: List ${n.label.toLowerCase()}
// parameters:
//   - { name: page, in: query, schema: { type: integer, default: 1 } }
//   - { name: per_page, in: query, schema: { type: integer, default: 50 } }
// responses:
//   '200': { description: All ${n.label.toLowerCase()} you may see, schema: Paginated${P} }

func (s *Server) list${P}(w http.ResponseWriter, r *http.Request, p principal) error {
	page, perPage, offset := pageParams(r)
	total, err := s.Store.Q.Count${P}(r.Context())
	if err != nil {
		return err
	}
	xs, err := s.Store.Q.List${P}(r.Context(), db.List${P}Params{LimCount: int64(perPage), LimOffset: int64(offset)})
	if err != nil {
		return err
	}
	return s.visible${P}(w, r, p, xs, int(total), page, perPage)
}
${sc ? `
// openapi:operation
// summary: List the ${n.label.toLowerCase()} of a ${sc.ref.one_label}
// parameters:
//   - { name: page, in: query, schema: { type: integer, default: 1 } }
//   - { name: per_page, in: query, schema: { type: integer, default: 50 } }
// responses:
//   '200': { description: The ${n.label.toLowerCase()} in the ${sc.ref.one_label} you may see, schema: Paginated${P} }
//   '404': Error

func (s *Server) list${sc.ref.Singular}${P}(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if _, err := s.Store.Q.Get${sc.ref.Singular}(r.Context(), id); err != nil {
		return fromStore(err, "${sc.ref.one_label}")
	}
	page, perPage, offset := pageParams(r)
	total, err := s.Store.Q.Count${P}By${sc.ref.Singular}(r.Context(), id)
	if err != nil {
		return err
	}
	xs, err := s.Store.Q.List${P}By${sc.ref.Singular}(r.Context(), db.List${P}By${sc.ref.Singular}Params{${sc.Go}: id, LimCount: int64(perPage), LimOffset: int64(offset)})
	if err != nil {
		return err
	}
	return s.visible${P}(w, r, p, xs, int(total), page, perPage)
}
` : ''}
// visible${P} writes the ${n.label.toLowerCase()} of xs the caller may see.
func (s *Server) visible${P}(w http.ResponseWriter, r *http.Request, p principal, xs []db.${S}, total, page, perPage int) error {
	all, ids, err := s.visible(r, p, ${permRead}, "${n.one}")
	if err != nil {
		return err
	}
	out := make([]${dto}, 0, len(xs))
	for _, x := range xs {
		if all || ids[x.ID] {
			out = append(out, to${S}(x))
		}
	}
	if !all {
		total = len(out)
	}
	return ok(w, paginated${P}{Items: out, Total: total, Page: page, PerPage: perPage})
}

// openapi:operation
// summary: Get a ${n.one_label}
// responses:
//   '200': { description: The ${n.one_label}, schema: ${S} }

func (s *Server) get${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if err := s.allow(r, p, ${permRead}, "${n.one}", id); err != nil {
		return err
	}
	x, err := s.Store.Q.Get${S}(r.Context(), id)
	if err != nil {
		return fromStore(err, "${n.one_label}")
	}
	return ok(w, to${S}(x))
}

// openapi:operation
// summary: Create a ${n.one_label}
// requestBody: { schema: Create${S}Request }
// responses:
//   '201': { description: Created, schema: ${S} }

func (s *Server) create${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleCreated(w, r, func(req create${S}Request) (${dto}, error) {
		v := db.${S}{${f.map((x) => `${x.Go}: ${fromReq(x)}`).join(', ')}}
		if err := check${S}(r.Context(), s.Store.Q, &v); err != nil {
			return ${dto}{}, err
		}
		id := store.NewID()
		err := s.Store.Q.Create${S}(r.Context(), db.Create${S}Params{ID: id, ${f.map((x) => `${x.Go}: v.${x.Go}`).join(', ')}, Now: store.Now()})
		if err != nil {
			return ${dto}{}, fromStore(err, "${n.one_label}")
		}
		x, err := s.Store.Q.Get${S}(r.Context(), id)
		if err != nil {
			return ${dto}{}, err
		}
		s.record(r, p, "${n.one}.create", "${n.one}", id, nil)
		s.changed(r, "${n.one}", id)
		return to${S}(x), nil
	})
}

// openapi:operation
// summary: Update a ${n.one_label}
// description: Only the fields present change.
// requestBody: { schema: Update${S}Request }
// responses:
//   '200': { description: Updated, schema: ${S} }

func (s *Server) update${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleAction(w, r, func(req update${S}Request) (${dto}, error) {
		id := r.PathValue("id")
		if err := s.allow(r, p, ${permWrite}, "${n.one}", id); err != nil {
			return ${dto}{}, err
		}
		var out db.${S}
		err := s.Store.Tx(r.Context(), func(q *db.Queries) error {
			v, err := q.Get${S}(r.Context(), id)
			if err != nil {
				return fromStore(err, "${n.one_label}")
			}
${f.map(setFromPatch).join('\n')}
			if err := check${S}(r.Context(), q, &v); err != nil {
				return err
			}
			if err := q.Update${S}(r.Context(), db.Update${S}Params{ID: id, ${f.map((x) => `${x.Go}: v.${x.Go}`).join(', ')}, Now: store.Now()}); err != nil {
				return fromStore(err, "${n.one_label}")
			}
			out, err = q.Get${S}(r.Context(), id)
			return err
		})
		if err != nil {
			return ${dto}{}, err
		}
		s.record(r, p, "${n.one}.update", "${n.one}", id, nil)
		s.changed(r, "${n.one}", id)
		return to${S}(out), nil
	})
}

// openapi:operation
// summary: Delete a ${n.one_label}
${o.scope ? `// description: Deletes what lives in it too.\n` : ''}// responses:
//   '204': { description: Deleted }

func (s *Server) delete${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if err := s.allow(r, p, ${permWrite}, "${n.one}", id); err != nil {
		return err
	}
	return handleCommand(w, func() error {
${p.rbac ? `		if err := s.Store.Q.DeleteObjectGrants(r.Context(), db.DeleteObjectGrantsParams{ObjectType: "${n.one}", ObjectID: id}); err != nil {\n			return err\n		}\n` : ''}		// ducktpl:on-delete ${n.one} (before the row goes: what references it)
		n, err := s.Store.Q.Delete${S}(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return notFound("${n.one_label}")
		}
		s.record(r, p, "${n.one}.delete", "${n.one}", id, nil)
		s.changed(r, "${n.one}", id)
		// ducktpl:on-deleted ${n.one}
		return nil
	})
}
`
}

function routes(n, p, scope) {
  const S = n.Singular, P = n.Plural, u = '/api/v1' + n.url
  const any = (h) => (p.auth ? `s.signedIn(s.${h})` : `s.public(s.${h})`)
  const create = p.auth ? `s.can(auth.Perm${P}Write, s.create${S})` : `s.public(s.create${S})`
  return `	mux.Handle("GET ${u}", ${any('list' + P)})
${scope ? `	mux.Handle("GET /api/v1${scope.ref.url}/{id}${n.url}", ${any('list' + scope.ref.Singular + P)})\n` : ''}	mux.Handle("POST ${u}", ${create})
	mux.Handle("GET ${u}/{id}", ${any('get' + S)})
	mux.Handle("PATCH ${u}/{id}", ${any('update' + S)})
	mux.Handle("DELETE ${u}/{id}", ${any('delete' + S)})

`
}

function test(n, f, p, scope) {
  const S = n.Singular, dto = camel(n.one) + 'DTO'
  const refs = f.filter((x) => x.ref)
  const v = (x) => camel(x.name) // projectID
  const value = (x, inline) => (
    x.ref
      ? (inline ? `${x.ref.seed}(c)` : v(x))
      : (x.enumValues && x.enumValues.length)
        ? `"${x.enumValues[0]}"`
        : x.t.sample
  )
  const cmpSample = (x) => (x.enumValues && x.enumValues.length ? `"${x.enumValues[0]}"` : x.t.sample)
  const body = (inline, over = {}) => 'map[string]any{' + f.map((x) => `"${x.name}": ${over[x.name] ?? value(x, inline)}`).join(', ') + '}'
  const cmp = f.find((x) => ['string', 'text', 'int', 'float', 'bool'].includes(x.type))
  const cascade = refs.find((x) => x.required)
  let s = `package server

import "testing"

// seed${S} creates a ${n.one_label} for tests that need one (ducktpl ref fields).
func seed${S}(c *client) string {
	c.t.Helper()
	var x ${dto}
	c.must(201, "POST", "${n.url}", ${body(true)}, &x)
	return x.ID
}

func Test${n.Plural}(t *testing.T) {
	c := newClient(t, newTestServer(t))
${p.auth ? '	c.login("admin", "admin-password")\n' : ''}${refs.map((x) => `	${v(x)} := ${x.ref.seed}(c)\n`).join('')}	var x ${dto}
	c.must(201, "POST", "${n.url}", ${body(false)}, &x)
	if x.ID == ""${cmp ? ` || x.${cmp.Go} != ${cmpSample(cmp)}` : ''} {
		t.Fatalf("created %+v", x)
	}
	c.must(200, "GET", "${n.url}/"+x.ID, nil, nil)
	c.must(200, "PATCH", "${n.url}/"+x.ID, map[string]any{${cmp ? `"${cmp.name}": ${cmp.t.other}` : ''}}, &x)
${cmp ? `	if x.${cmp.Go} != ${cmp.t.other} {\n		t.Fatalf("patched %+v", x)\n	}\n` : ''}	c.must(400, "POST", "${n.url}", map[string]any{"nope": 1}, nil)
${f.filter((x) => x.required && isText(x)).map((x) => `	c.must(400, "PATCH", "${n.url}/"+x.ID, map[string]any{"${x.name}": ""}, nil)\n`).join('')}${refs.map((x) => `	c.must(400, "POST", "${n.url}", ${body(false, { [x.name]: '"missing"' })}, nil)\n`).join('')}	var list paginated${n.Plural}
	c.must(200, "GET", "${n.url}", nil, &list)
	if len(list.Items) != 1 || list.Total != 1 {
		t.Fatalf("list %+v", list)
	}
`
  if (scope) {
    s += `	var in paginated${n.Plural}
	c.must(200, "GET", "${scope.ref.url}/"+${v(scope)}+"${n.url}", nil, &in)
	if len(in.Items) != 1 || in.Items[0].ID != x.ID || in.Total != 1 {
		t.Fatalf("in the ${scope.ref.one_label}: %+v", in)
	}
	c.must(200, "GET", "${scope.ref.url}/"+${scope.ref.seed}(c)+"${n.url}", nil, &in)
	if len(in.Items) != 0 || in.Total != 0 {
		t.Fatalf("in another ${scope.ref.one_label}: %+v", in)
	}
	c.must(404, "GET", "${scope.ref.url}/missing${n.url}", nil, nil)
`
  }
  s += `	c.must(204, "DELETE", "${n.url}/"+x.ID, nil, nil)
	c.must(404, "GET", "${n.url}/"+x.ID, nil, nil)
`
  if (cascade) {
    s += `	// deleting the ${cascade.ref.one_label} deletes its ${n.label.toLowerCase()}
	c.must(201, "POST", "${n.url}", ${body(false)}, &x)
	c.must(204, "DELETE", "${cascade.ref.url}/"+${v(cascade)}, nil, nil)
	c.must(404, "GET", "${n.url}/"+x.ID, nil, nil)
`
  }
  return s + '}\n'
}

// ---- the web page ----

function page(n, f, o) {
  const S = n.Singular, P = n.Plural
  const sc = o.scopeField
  const cols = f.slice(0, 4)
  const tables = (xs) => [...new Map(xs.filter((x) => x.ref).map((x) => [x.ref.table, x.ref])).values()]
  const rows = (ref) => camel(ref.table) + 'Rows' // projectsRows
  const useRows = (refs) => refs.map((r) => `  const ${rows(r)} = useResource<Page<Schemas['${r.Singular}']>>('${r.url}?all=1').data?.items || []\n`).join('')
  const shown = (ref, id) => `${rows(ref)}.find((o) => o.id === ${id})?.${ref.show} ?? '—'`
  const option = (ref) => `{${rows(ref)}.map((o) => <option key={o.id} value={o.id}>{o.${ref.show} || o.id}</option>)}`
  const control = (x) => {
    const set = (val) => `onChange={(e) => setV({ ...v, ${x.name}: ${val} })}`
    if (x.enumValues && x.enumValues.length) {
      return `<Field label={t('${label(x.name)}')}>
          <select value={v.${x.name}} ${set('e.currentTarget.value')}>
            ${x.enumValues.map((opt) => `<option value="${opt}">{t('${opt}')}</option>`).join('\n            ')}
          </select>
        </Field>`
    }
    switch (x.type) {
      case 'bool': return `<label className="check"><input type="checkbox" checked={v.${x.name}} ${set('e.currentTarget.checked')} /> {t('${label(x.name)}')}</label>`
      case 'text': return `<Field label={t('${label(x.name)}')}><textarea rows={4} value={v.${x.name}} ${set('e.currentTarget.value')} /></Field>`
      case 'int': return `<Field label={t('${label(x.name)}')}><input type="number" step={1} value={v.${x.name}} ${set('Math.trunc(Number(e.currentTarget.value))')} /></Field>`
      case 'float': return `<Field label={t('${label(x.name)}')}><input type="number" step="any" value={v.${x.name}} ${set('Number(e.currentTarget.value)')} /></Field>`
      case 'time': return `<Field label={t('${label(x.name)}')}><input type="datetime-local" value={toLocalInput(v.${x.name})} ${set(`fromLocalInput(e.currentTarget.value)${x.required ? " ?? ''" : ''}`)} /></Field>`
      case 'ref':
        return `<Field label={t('${label(x.name)}')}>
          <select value={v.${x.name}${x.required ? '' : " ?? ''"}} ${set(`e.currentTarget.value${x.required ? '' : ' || null'}`)}>
            <option value=""${x.required ? ' disabled' : ''}>—</option>
            ${option(x.ref)}
          </select>
        </Field>`
      default: return `<Field label={t('${label(x.name)}')}><input value={v.${x.name}} ${set('e.currentTarget.value')} /></Field>`
    }
  }
  const cell = (x) => {
    if (x.enumValues && x.enumValues.length) {
      return `(x) => <span className="badge badge-subtle">{x.${x.name}}</span>`
    }
    switch (x.type) {
      case 'bool': return `(x) => (x.${x.name} ? <Check size={14} /> : null)`
      case 'text': return `(x) => <span className="muted small ellipsis">{x.${x.name}.split('\\n')[0]}</span>`
      case 'time': return `(x) => <span className="small">{dateTime(x.${x.name})}</span>`
      case 'ref': return `(x) => <span>{${shown(x.ref, `x.${x.name}`)}}</span>`
      default: return `(x) => <span>{x.${x.name}}</span>`
    }
  }
  const sort = (x) => (x.type === 'bool' ? `(x.${x.name} ? 1 : 0)` : x.type === 'ref' ? shown(x.ref, `x.${x.name}`) : x.nullable ? `x.${x.name} ?? ''` : `x.${x.name}`)
  const initial = (x) => {
    if (x === sc) return `initial?.${x.name} ?? scope ?? ''`
    if (x.enumValues && x.enumValues.length) return `initial?.${x.name} ?? '${x.defaultValue || x.enumValues[0]}'`
    if (x.nullable) return `initial?.${x.name} ?? null`
    if (x.type === 'time') return `initial?.${x.name} ?? new Date().toISOString()`
    if (x.type === 'ref') return `initial?.${x.name} ?? ''`
    return `initial?.${x.name} ?? ${x.t.empty}`
  }
  const blocks = f.filter((x) => x.required && x.t.ts === 'string').map((x) => (isText(x) ? ` || !v.${x.name}.trim()` : ` || !v.${x.name}`))
  const head = f.find(isText)
  const path = sc ? `scope ? \`${sc.ref.url}/\${enc(scope)}${n.url}\` : '${n.url}'` : `'${n.url}'`
  const key = `${path} + \`?page=\${page}&per_page=\${perPage}\``
  return `import { t } from '../i18n'
import { useMemo, useState } from 'react'
import { ListTodo, Plus, Search, X, Pencil, Trash2${cols.some((x) => x.type === 'bool') ? ', Check' : ''} } from 'lucide-react'
import { api, enc } from '../lib/api'
import type { ${S}, Page${f.some((x) => x.ref) ? ', Schemas' : ''} } from '../lib/api'
import { invalidate, useResource } from '../lib/store'
import { ago, dateTime${f.some((x) => x.type === 'time') ? ', fromLocalInput, toLocalInput' : ''} } from '../lib/format'
${sc ? "import { usePref } from '../lib/prefs'\n" : ''}import type { MenuEntry } from '../ui/ContextMenu'
import { DataTable, Empty, Spinner } from '../ui/common'
import { Modal, confirm, openDialog, toast } from '../ui/overlays'
import { Field } from '../ui/Field'
${o.scope ? '// ducktpl:imports\n' : ''}
// Generated by ducktpl ${o.cmd}. It is yours now: edit freely.

export const ${P}Icon = ListTodo

function actions(x: ${S}): MenuEntry[] {
  return [
    { header: ${head ? `x.${head.name} || ` : ''}x.id },
    { label: t('Edit…'), icon: <Pencil size={14} />, onClick: () => openDialog((c) => <${S}Dialog initial={x} onClose={c} />) },
${o.scope ? '    // ducktpl:scope-links\n' : ''}    'sep',
    {
      label: t('Delete'), icon: <Trash2 size={14} />, danger: true, onClick: async () => {
        if (!(await confirm({ title: t('Delete this ${n.one_label}?'), body: t('${o.scope ? 'Everything in it is deleted too. ' : ''}This cannot be undone.'), danger: true, confirm: t('Delete') }))) return
        api.del(\`${n.url}/\${enc(x.id)}\`).then(() => invalidate('${n.url}'), toast.err)
      },
    },
  ]
}

export function ${P}() {
${sc ? `  // the ${sc.ref.one_label} shown; '' is all of them (ducktpl addToScope)\n  const [scope, setScope] = usePref('scope:${sc.ref.table}', '')\n` : ''}  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [q, setQ] = useState('')
  const { data, error, loading } = useResource<Page<${S}>>(${key})
${useRows(tables(sc ? [sc, ...cols] : cols))}  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\\s+/).filter(Boolean)
    return (data?.items || []).filter((x) => words.every((w) => JSON.stringify(x).toLowerCase().includes(w)))
  }, [data?.items, q])
  const create = () => openDialog((c) => <${S}Dialog${sc ? ' scope={scope}' : ''} onClose={c} />)
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <ListTodo size={20} />
          <h1>{t('${n.label}')}</h1>
          <span className="count">{data?.total ?? 0}</span>
          {loading && <Spinner />}
        </div>
        <div className="page-actions">
${sc ? `          <select value={scope} onChange={(e) => setScope(e.currentTarget.value)} title={t('${label(sc.name)}')}>
            <option value="">{t('All ${sc.ref.label.toLowerCase()}')}</option>
            ${option(sc.ref)}
          </select>
` : ''}          <div className="search">
            <Search size={14} />
            <input placeholder={t('Search…')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            {q && <button className="icon-btn" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={create}><Plus size={14} /> {t('New')}</button>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-bad">{error.message}</div>}
        {data && data.total === 0 ? (
          <Empty icon={<ListTodo size={28} />} title={t('Nothing here yet')} action={<button className="btn btn-primary" onClick={create}><Plus size={14} /> {t('New')}</button>} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(x) => x.id}
            onOpen={(x) => openDialog((c) => <${S}Dialog initial={x} onClose={c} />)}
            rowMenu={actions}
            defaultSort={{ key: 'updated', dir: -1 }}
            pagination={{
              page,
              perPage,
              total: data?.total ?? 0,
              onPageChange: setPage,
              onPerPageChange: (pp) => { setPerPage(pp); setPage(1) },
            }}
            columns={[
${cols.map((x) => `              { key: '${x.name}', label: t('${label(x.name)}'), sort: (x) => ${sort(x)}, render: ${cell(x)} },`).join('\n')}
              { key: 'updated', label: t('Updated'), sort: (x) => x.updated_at, render: (x) => <span className="muted small" title={dateTime(x.updated_at)}>{ago(x.updated_at)}</span> },
            ]}
          />
        )}
      </div>
    </div>
  )
}

function ${S}Dialog({ initial, ${sc ? 'scope, ' : ''}onClose }: { initial?: ${S}; ${sc ? 'scope?: string; ' : ''}onClose: () => void }) {
${useRows(tables(f))}  const [v, setV] = useState({
${f.map((x) => `    ${x.name}: ${initial(x)},`).join('\n')}
  })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      if (initial) await api.patch(\`${n.url}/\${enc(initial.id)}\`, v)
      else await api.post('${n.url}', v)
      invalidate('${n.url}')
      onClose()
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? t('Edit ${n.one_label}') : t('New ${n.one_label}')}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn btn-primary" disabled={busy${blocks.join('')}} onClick={submit}>{initial ? t('Save') : t('Create')}</button>
      </>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
${f.map((x) => '        ' + control(x)).join('\n')}
      </form>
    </Modal>
  )
}
`
}

// ---- inserting at anchors ----

const anchorRe = (anchor) => new RegExp(`^([ \\t]*)(//|#) ducktpl:${anchor}\\b.*$`, 'm')

function insert(text, anchor, lines, file) {
  const m = anchorRe(anchor).exec(text)
  if (!m) {
    throw new Error(`${file}: anchor "ducktpl:${anchor}" not found. Re-add "// ducktpl:${anchor}" or "# ducktpl:${anchor}" where new entries should be injected.`)
  }
  return text.slice(0, m.index) + lines + text.slice(m.index)
}

/**
 * Plans every change. Nothing is written until apply(). Returns the files
 * ({path, content, created}), the fields (with the scope's ref first when
 * there is one) and notes on what it could not do.
 *
 * opts.cmd: add | addScope | addToScope; opts.scope: the scope's table, for
 * addToScope.
 */
export function plan(p, n, fields, opts = { cmd: 'add' }) {
  if (typeof n === 'string') n = resourceNames(n, opts.singular)
  const out = []
  const notes = []
  const fileExists = (rel) => (p.existsSync ? p.existsSync(rel) : existsSync(join(p.root, rel)))
  const getFile = (rel) => (p.readFile ? p.readFile(rel) : read(p.root, rel))

  const add = (path, content) => {
    if (fileExists(path)) throw new Error(`${path} already exists: is "${n.table}" already there?`)
    out.push({ path, content, created: true })
  }
  const patch = (path, fn) => {
    const prev = out.find((x) => x.path === path)
    const cur = prev ? prev.content : getFile(path)
    const next = fn(cur)
    if (prev) prev.content = next
    else out.push({ path, content: next, created: false })
  }
  if (fileExists(`gateway/internal/store/queries/${n.table}.sql`)) throw new Error(`queries/${n.table}.sql already exists: is "${n.table}" already there?`)

  const o = { cmd: [opts.cmd, opts.scope, n.table].filter(Boolean).join(' '), scope: opts.cmd === 'addScope' }
  if (opts.scope) {
    const scopePage = `web/src/pages/${pascal(opts.scope)}.tsx`
    if (!fileExists(scopePage) || !anchorRe('scope-links').test(getFile(scopePage))) {
      throw new Error(`"${opts.scope}" is not a scope: make it with ducktpl addScope ${opts.scope} …`)
    }
    // the ref to the scope: given (required) or added first
    let sf = fields.find((x) => x.type === 'ref' && x.target === opts.scope)
    if (sf && !sf.required) throw new Error(`field ${sf.name}: the ref to the scope is required (${sf.name.replace(/_id$/, '')}:ref:${opts.scope}!)`)
    if (!sf) {
      sf = field(singularize(opts.scope) + '_id', 'ref', true, opts.scope)
      if (fields.some((x) => x.name === sf.name)) throw new Error(`field ${sf.name} is the scope's: drop it, or make it ${sf.name.replace(/_id$/, '')}:ref:${opts.scope}!`)
      fields = [sf, ...fields]
    }
    o.scopeField = sf
    o.scopePage = scopePage
  }
  if (!fields.length) throw new Error('give at least one field, e.g. title:string! done:bool')
  for (const x of fields.filter((x) => x.type === 'ref')) {
    if (x.target === n.table) throw new Error(`field ${x.name}: a resource cannot ref itself yet; add the column by hand`)
    x.ref = target(p, x.target)
  }

  let dtoFields = fields
  if (opts.dtoOnly || opts.dto) {
    const onlySet = new Set((opts.dtoOnly || opts.dto).split(',').map((s) => s.trim().toLowerCase()))
    dtoFields = fields.filter((x) => onlySet.has(x.name))
  }
  if (opts.dtoOmit) {
    const omitSet = new Set(opts.dtoOmit.split(',').map((s) => s.trim().toLowerCase()))
    dtoFields = dtoFields.filter((x) => !omitSet.has(x.name))
  }
  o.dtoFields = dtoFields

  const num = nextMigration(p.root, opts.extraMigrationFiles || [])
  add(`gateway/internal/store/migrations/sqlite/${num}_${n.table}.sql`, migration('sqlite', n, fields, p))
  add(`gateway/internal/store/migrations/postgres/${num}_${n.table}.sql`, migration('pg', n, fields, p))
  add(`gateway/internal/store/queries/${n.table}.sql`, queries(n, fields, p, o.scopeField))
  add(`gateway/internal/server/${n.table}.go`, handler(n, fields, p, o))
  add(`gateway/internal/server/${n.table}_test.go`, test(n, fields, p, o.scopeField))
  patch('gateway/internal/server/server.go', (s) => insert(s, 'routes', routes(n, p, o.scopeField), 'server.go'))
  if (p.auth) {
    const P = n.Plural
    patch('gateway/internal/auth/perms.go', (s) => {
      s = insert(s, 'perms', `	Perm${P}Read  = "${n.table}.read"\n	Perm${P}Write = "${n.table}.write"\n`, 'perms.go')
      s = insert(s, 'catalog', `	{Perm${P}Read, "Read every ${n.one_label}"},\n	{Perm${P}Write, "Create, edit and delete every ${n.one_label}"},\n`, 'perms.go')
      return insert(s, 'user-perms', `		Perm${P}Read, Perm${P}Write,\n`, 'perms.go')
    })
  }
  if (p.rbac) {
    patch('gateway/internal/server/rbac.go', (s) => insert(s, 'objects', `	"${n.one}": {auth.Perm${n.Plural}Read, auth.Perm${n.Plural}Write},\n`, 'rbac.go'))
  }
  // deleting what a ref points to takes the grants of what the cascade
  // deletes, and sends a live event so open lists refetch
  for (const x of fields.filter((x) => x.ref)) {
    const h = x.ref.handler
    if (!h) {
      notes.push(`no "ducktpl:on-delete ${x.ref.one}" anchor: deleting a ${x.ref.one_label} will not refresh open ${n.label.toLowerCase()} lists${x.required && p.rbac ? ' nor drop their grants' : ''}`)
      continue
    }
    patch(h, (s) => {
      if (x.required && p.rbac) s = insert(s, `on-delete ${x.ref.one}`, `		if err := s.Store.Q.${grantsQuery(n, x)}(r.Context(), id); err != nil {\n			return err\n		}\n`, h)
      return insert(s, `on-deleted ${x.ref.one}`, `		s.changed(r, "${n.one}", "")\n`, h)
    })
  }

  // Auto-scaffold test seed helper if missing from tests
  for (const x of fields.filter((x) => x.ref && x.ref.seedMissing)) {
    const stPath = 'gateway/internal/server/server_test.go'
    if (existsSync(join(p.root, stPath))) {
      patch(stPath, (s) => s + `\n// ${x.ref.seed} creates a ${x.ref.one_label} for tests (ducktpl auto-scaffolded for ref fields).\nfunc ${x.ref.seed}(c *client) string {\n\tc.t.Helper()\n\tvar res map[string]any\n\tc.must(201, "POST", "${x.ref.url}", map[string]any{"${x.ref.show}": "seed " + store.NewID()}, &res)\n\tif id, ok := res["id"].(string); ok {\n\t\treturn id\n\t}\n\treturn store.NewID()\n}\n`)
      notes.push(`auto-scaffolded test helper "${x.ref.seed}" in ${stPath}`)
    } else {
      notes.push(`test helper "${x.ref.seed}" not found in test suite; add func ${x.ref.seed}(c *client) string`)
    }
  }

  add(`web/src/pages/${n.Plural}.tsx`, page(n, fields, o))
  patch('web/src/lib/api.ts', (s) => insert(s, 'types', `export type ${n.Singular} = Schemas['${n.Singular}']\nexport type Paginated${n.Plural} = Schemas['Paginated${n.Plural}']\n`, 'api.ts'))
  patch('web/src/App.tsx', (s) => {
    s = insert(s, 'imports', `import { ${n.Plural}, ${n.Plural}Icon } from './pages/${n.Plural}'\n`, 'App.tsx')
    s = insert(s, 'nav', `  { id: '${n.url.slice(1)}', label: t('${n.label}'), icon: ${n.Plural}Icon },\n`, 'App.tsx')
    return insert(s, 'pages', `    case '${n.url.slice(1)}': page = <${n.Plural} />; break\n`, 'App.tsx')
  })
  if (p.live) patch('web/src/lib/live.ts', (s) => insert(s, 'live', `  ${n.one}: '${n.url}',\n`, 'live.ts'))
  if (o.scopeField) {
    // the scope's row menu opens this page on that scope
    const sc = o.scopeField.ref
    patch(o.scopePage, (s) => {
      const want = [`import { setPref } from '../lib/prefs'`, `import { go } from '../lib/router'`, `import { ${n.Plural}Icon } from './${n.Plural}'`]
      const missing = want.filter((l) => !s.includes(l + '\n'))
      if (missing.length) s = insert(s, 'imports', missing.map((l) => l + '\n').join(''), o.scopePage)
      return insert(s, 'scope-links', `    { label: t('${n.label}'), icon: <${n.Plural}Icon size={14} />, onClick: () => (setPref('scope:${sc.table}', x.id), go('${n.url.slice(1)}')) },\n`, o.scopePage)
    })
  }
  return { files: out, fields, notes }
}

export function apply(root, files) {
  for (const f of files) writeFileSync(join(root, f.path), f.content)
}

export function applyWithRollback(root, files) {
  const backups = []
  const createdPaths = []

  for (const f of files) {
    const full = join(root, f.path)
    if (existsSync(full)) {
      backups.push({ path: full, content: readFileSync(full, 'utf8') })
    } else {
      createdPaths.push(full)
    }
  }

  for (const f of files) {
    writeFileSync(join(root, f.path), f.content)
  }

  return {
    rollback: () => {
      for (const b of backups) {
        writeFileSync(b.path, b.content, 'utf8')
      }
      for (const p of createdPaths) {
        if (existsSync(p)) rmSync(p, { force: true })
      }
    },
    createdCount: createdPaths.length,
    updatedCount: backups.length,
    createdPaths,
  }
}

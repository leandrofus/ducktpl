// moddb: database schema modifications for create-duck projects.
//
// Supports:
//   ducktpl moddb addColumn <table> <field:type[!]>
//   ducktpl moddb removeColumn <table> <column>
//   ducktpl moddb changeType <table> <column:type[!]> --force
//   ducktpl moddb renameColumn <table> <old_name> <new_name>
//   (and alias renameColum)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TYPES, TYPE_ALIASES, colType, parseSingleField, singularize, target } from './generate.mjs'
import { addFieldToHandler, addKeyToTest, removeFieldFromHandler, removeKeyFromTest } from './handleredit.mjs'

const pascal = (snake) => snake.split('_').map((w) => (w === 'id' ? 'ID' : w[0].toUpperCase() + w.slice(1))).join('')
const camel = (snake) => {
  const p = pascal(snake)
  return p[0].toLowerCase() + p.slice(1)
}

function nextMigration(root) {
  const dir = join(root, 'gateway/internal/store/migrations/sqlite')
  if (!existsSync(dir)) throw new Error(`migrations directory not found: ${dir}`)
  const nums = readdirSync(dir).map((f) => parseInt(f, 10)).filter((n) => !isNaN(n))
  return String(Math.max(0, ...nums) + 1).padStart(5, '0')
}

export function findTable(root, name) {
  const dir = join(root, 'gateway/internal/store/migrations/sqlite')
  if (!existsSync(dir)) throw new Error(`migrations directory not found: ${dir}`)
  const files = readdirSync(dir).sort()
  const tables = new Set()
  for (const f of files) {
    if (!f.endsWith('.sql')) continue
    const content = readFileSync(join(dir, f), 'utf8')
    const matches = content.matchAll(/CREATE\s+TABLE\s+([a-z0-9_]+)/gi)
    for (const m of matches) tables.add(m[1])
  }

  if (tables.has(name)) return name
  const sing = singularize(name)
  if (tables.has(sing)) return sing
  if (tables.has(name + 's')) return name + 's'
  if (tables.has(name + 'es')) return name + 'es'

  throw new Error(`table "${name}" not found (existing: ${[...tables].join(', ') || 'none'})`)
}

export function inspectTable(root, table) {
  const sqliteDir = join(root, 'gateway/internal/store/migrations/sqlite')
  const pgDir = join(root, 'gateway/internal/store/migrations/postgres')

  const columns = new Map() // name -> { name, sqliteDef, pgDef, sqliteType, pgType }

  const parseCols = (dir) => {
    const colDefs = new Map()
    const files = readdirSync(dir).sort()
    for (const f of files) {
      if (!f.endsWith('.sql')) continue
      const rawText = readFileSync(join(dir, f), 'utf8')
      const text = rawText.split(/--\s*\+goose\s+Down/i)[0]
      const createMatch = new RegExp(`CREATE\\s+TABLE\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(text)
      if (createMatch) {
        const lines = createMatch[1].split('\n')
        for (const l of lines) {
          const m = /^\s*([a-z][a-z0-9_]*)\s+([^,]+),?$/i.exec(l)
          if (m && !m[1].startsWith('--')) {
            colDefs.set(m[1].toLowerCase(), m[2].trim())
          }
        }
      }

      // Track ADD COLUMN
      const addMatches = text.matchAll(new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+([a-z][a-z0-9_]*)\\s+([^;]+);`, 'gi'))
      for (const m of addMatches) {
        colDefs.set(m[1].toLowerCase(), m[2].trim())
      }

      // Track DROP COLUMN
      const dropMatches = text.matchAll(new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+DROP\\s+COLUMN\\s+([a-z][a-z0-9_]*);`, 'gi'))
      for (const m of dropMatches) {
        colDefs.delete(m[1].toLowerCase())
      }

      // Track RENAME COLUMN
      const renameMatches = text.matchAll(new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+RENAME\\s+COLUMN\\s+([a-z][a-z0-9_]*)\\s+TO\\s+([a-z][a-z0-9_]*);`, 'gi'))
      for (const m of renameMatches) {
        const oldName = m[1].toLowerCase()
        const newName = m[2].toLowerCase()
        if (colDefs.has(oldName)) {
          const def = colDefs.get(oldName)
          colDefs.delete(oldName)
          colDefs.set(newName, def)
        }
      }
    }
    return colDefs
  }

  const parseIndexes = (dir) => {
    const idxs = []
    const files = readdirSync(dir).sort()
    for (const f of files) {
      if (!f.endsWith('.sql')) continue
      const rawText = readFileSync(join(dir, f), 'utf8')
      const text = rawText.split(/--\s*\+goose\s+Down/i)[0]
      const matches = text.matchAll(new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+([a-z0-9_]+)\\s+ON\\s+${table}\\s*\\(([^)]+)\\);`, 'gi'))
      for (const m of matches) {
        idxs.push(m[0].trim())
      }
    }
    return idxs
  }

  const sqliteCols = parseCols(sqliteDir)
  const pgCols = existsSync(pgDir) ? parseCols(pgDir) : new Map()
  const indexes = parseIndexes(sqliteDir)

  for (const [name, sqliteDef] of sqliteCols.entries()) {
    const pgDef = pgCols.get(name) || sqliteDef
    columns.set(name, {
      name,
      sqliteDef,
      pgDef,
    })
  }

  return { table, columns, indexes }
}

export function parseFieldSpec(spec, argType) {
  let name, type, bang, target
  if (argType) {
    name = spec
    type = argType
    if (type.endsWith('!')) {
      bang = '!'
      type = type.slice(0, -1)
    }
  } else {
    const m = /^([a-z][a-z0-9_]*):([a-z0-9_(),]+)(?::([a-z][a-z0-9_]*))?(!?)$/i.exec(spec)
    if (!m) throw new Error(`field "${spec}": write name:type, with ! for required (types: ${Object.keys(TYPES).join(', ')}; refs: name:ref:<resource>)`)
    ;[, name, type, target, bang] = m
  }

  const rawType = type
  const normalizedType = TYPE_ALIASES[type.toLowerCase()] || type.toLowerCase()
  if (normalizedType === 'ref') {
    if (!target && !argType) throw new Error(`field "${spec}": which resource? e.g. ${name}:ref:projects`)
    if (target && !name.endsWith('_id')) name += '_id'
  }

  let t = TYPES[normalizedType]
  if (!t) {
    // Fallback for custom SQL types (e.g. numeric(10,2), varchar(50), etc.)
    t = {
      go: 'string',
      sqlite: rawType,
      pg: rawType,
      schema: '{ type: string }',
      ts: 'string',
      empty: "''",
    }
  }

  return {
    name,
    type: normalizedType,
    rawType,
    target,
    required: !!bang,
    t,
    Go: pascal(name),
  }
}

export function updateQueries(sqlText, table, action, details) {
  let text = sqlText

  if (action === 'addColumn') {
    const { name } = details
    // Update INSERT INTO <table> (...) VALUES (...)
    const insertRe = new RegExp(`(INSERT\\s+INTO\\s+${table}\\s*\\()([^)]+)(\\)\\s*VALUES\\s*\\()([^)]+)(\\);)`, 'i')
    text = text.replace(insertRe, (match, p1, cols, p3, vals, p5) => {
      const colList = cols.split(',').map((c) => c.trim())
      const valList = vals.split(',').map((v) => v.trim())
      if (colList.includes(name)) return match
      // Insert before created_at if present, else append
      const cIdx = colList.indexOf('created_at')
      if (cIdx >= 0) {
        colList.splice(cIdx, 0, name)
        valList.splice(cIdx, 0, '@' + name)
      } else {
        colList.push(name)
        valList.push('@' + name)
      }
      return `${p1}${colList.join(', ')}${p3}${valList.join(', ')}${p5}`
    })

    // Update UPDATE <table> SET ... WHERE
    const updateRe = new RegExp(`(UPDATE\\s+${table}\\s+SET\\s+)([^;]+?)(\\s+WHERE\\s+id\\s*=)`, 'i')
    text = text.replace(updateRe, (match, p1, sets, p3) => {
      if (sets.includes(`${name} =`)) return match
      let newSets
      if (sets.includes('updated_at = @now')) {
        newSets = sets.replace('updated_at = @now', `${name} = @${name}, updated_at = @now`)
      } else {
        newSets = sets.trim() + `, ${name} = @${name}`
      }
      return `${p1}${newSets}${p3}`
    })
  } else if (action === 'removeColumn') {
    const { name } = details
    // Remove from INSERT
    const insertRe = new RegExp(`(INSERT\\s+INTO\\s+${table}\\s*\\()([^)]+)(\\)\\s*VALUES\\s*\\()([^)]+)(\\);)`, 'i')
    text = text.replace(insertRe, (match, p1, cols, p3, vals, p5) => {
      const colList = cols.split(',').map((c) => c.trim())
      const valList = vals.split(',').map((v) => v.trim())
      const idx = colList.indexOf(name)
      if (idx >= 0) {
        colList.splice(idx, 1)
        valList.splice(idx, 1)
      }
      return `${p1}${colList.join(', ')}${p3}${valList.join(', ')}${p5}`
    })

    // Remove from UPDATE
    const updateRe = new RegExp(`(UPDATE\\s+${table}\\s+SET\\s+)([^;]+?)(\\s+WHERE\\s+id\\s*=)`, 'i')
    text = text.replace(updateRe, (match, p1, sets, p3) => {
      const setParts = sets.split(',').map((s) => s.trim()).filter((s) => !s.startsWith(`${name} =`))
      return `${p1}${setParts.join(', ')}${p3}`
    })
  } else if (action === 'renameColumn') {
    const { oldName, newName } = details
    // Replace standalone column identifier
    text = text.replaceAll(new RegExp(`\\b${oldName}\\b`, 'g'), newName)
  }

  return text
}

export function updateHandler(code, table, action, details) {
  if (action === 'addColumn') return addFieldToHandler(code, details.field)
  if (action === 'removeColumn') return removeFieldFromHandler(code, details.name, pascal(details.name))
  if (action === 'changeType') {
    // out with the old column, in with the new one: the generator's own pieces for its type
    return addFieldToHandler(removeFieldFromHandler(code, details.field.name, details.field.Go), details.field)
  }
  if (action === 'renameColumn') {
    const { oldName, newName } = details
    const OldGo = pascal(oldName)
    const NewGo = pascal(newName)
    return code
      .replaceAll(`\`json:"${oldName}"\``, `\`json:"${newName}"\``)
      .replaceAll(`//   ${oldName}:`, `//   ${newName}:`)
      .replaceAll(`"${oldName}":`, `"${newName}":`)
      .replaceAll(new RegExp(`\\b${OldGo}\\b`, 'g'), NewGo)
  }
  return code
}

export function planModdb(p, subcmd, args, opts = {}) {
  const normSubcmd = (subcmd || '').trim()
  const validSubcmds = new Set(['addColumn', 'removeColumn', 'changeType', 'renameColumn', 'renameColum'])
  if (!validSubcmds.has(normSubcmd)) {
    throw new Error(`unknown moddb command "${subcmd}" (valid: addColumn, removeColumn, changeType, renameColumn)`)
  }

  const tableArg = args[0]
  if (!tableArg) throw new Error(`which table? e.g. ducktpl moddb ${normSubcmd} tasks ...`)
  const table = findTable(p.root, tableArg)
  const info = inspectTable(p.root, table)
  const num = nextMigration(p.root)

  const files = []
  const notes = []
  const qpath = `gateway/internal/store/queries/${table}.sql`
  const hasQueries = existsSync(join(p.root, qpath))

  // Find handler
  const serverDir = join(p.root, 'gateway/internal/server')
  let handlerPath = null
  if (existsSync(serverDir)) {
    const sFiles = readdirSync(serverDir)
    if (sFiles.includes(`${table}.go`)) handlerPath = `gateway/internal/server/${table}.go`
    else if (sFiles.includes(`${singularize(table)}.go`)) handlerPath = `gateway/internal/server/${singularize(table)}.go`
  }

  // Find frontend page
  const webPagesDir = join(p.root, 'web/src/pages')
  let frontendPage = null
  if (existsSync(webPagesDir)) {
    const pFiles = readdirSync(webPagesDir)
    const sing = singularize(table)
    const candidates = [
      `${table}.tsx`,
      `${sing}.tsx`,
      `${pascal(table)}.tsx`,
      `${pascal(sing)}.tsx`,
    ]
    for (const cand of candidates) {
      if (pFiles.includes(cand)) {
        frontendPage = `web/src/pages/${cand}`
        break
      }
    }
  }

  // the resource's test: payloads that create it
  const testCandidates = [`gateway/internal/server/${table}_test.go`, `gateway/internal/server/${singularize(table)}_test.go`]
  const testPath = testCandidates.find((f) => existsSync(join(p.root, f))) || null
  const urlOf = '/' + table.replace(/_/g, '-')
  const editTest = (fn) => {
    if (!testPath) return
    const tText = readFileSync(join(p.root, testPath), 'utf8')
    const updated = fn(tText)
    if (updated !== tText) files.push({ path: testPath, content: updated, created: false })
  }
  const sampleOf = (field) => (field.enumValues && field.enumValues.length ? `"${field.enumValues[0]}"` : field.t.sample)
  // a "name:type" spec, or the older "name type"
  const parseField = (spec, argType) => {
    const f = parseSingleField(argType ? `${spec}:${argType}` : spec)
    if (f.type === 'ref') f.ref = target(p, f.target)
    return f
  }

  if (normSubcmd === 'addColumn') {
    const spec = args[1]
    if (!spec) throw new Error(`which column? e.g. ducktpl moddb addColumn ${table} status:string!`)
    const field = parseField(spec, args[2])
    if (info.columns.has(field.name)) {
      throw new Error(`column "${field.name}" already exists on table "${table}"`)
    }
    if (field.type === 'ref' && field.required) {
      throw new Error(`"${field.name}": existing rows have no value for a required reference; add it optional (drop the !) and fill it in`)
    }
    if (field.type === 'time' && field.required) {
      throw new Error(`"${field.name}": existing rows have no value for a required time; add it optional (drop the !)`)
    }

    // ALTER TABLE ... ADD COLUMN cannot carry UNIQUE: a unique index does the same
    const col = { ...field, unique: false }
    const sqliteType = colType('sqlite', col)
    const pgType = colType('pg', col)
    const idx = []
    if (field.unique) idx.push({ up: `CREATE UNIQUE INDEX ${table}_${field.name}_key ON ${table} (${field.name});`, down: `DROP INDEX IF EXISTS ${table}_${field.name}_key;` })
    else if (field.type === 'ref' || field.index) idx.push({ up: `CREATE INDEX ${table}_${field.name} ON ${table} (${field.name});`, down: `DROP INDEX IF EXISTS ${table}_${field.name};` })
    const extraUp = idx.map((i) => '\n' + i.up).join('')
    const extraDown = idx.map((i) => i.down + '\n').join('')

    const sqliteMig = `-- +goose Up\nALTER TABLE ${table} ADD COLUMN ${field.name} ${sqliteType};${extraUp}\n\n-- +goose Down\n${extraDown}ALTER TABLE ${table} DROP COLUMN ${field.name};\n`
    const pgMig = `-- +goose Up\nALTER TABLE ${table} ADD COLUMN ${field.name} ${pgType};${extraUp}\n\n-- +goose Down\n${extraDown}ALTER TABLE ${table} DROP COLUMN ${field.name};\n`

    files.push({
      path: `gateway/internal/store/migrations/sqlite/${num}_add_${field.name}_to_${table}.sql`,
      content: sqliteMig,
      created: true,
    })
    files.push({
      path: `gateway/internal/store/migrations/postgres/${num}_add_${field.name}_to_${table}.sql`,
      content: pgMig,
      created: true,
    })

    if (hasQueries) {
      const qText = readFileSync(join(p.root, qpath), 'utf8')
      const updatedQ = updateQueries(qText, table, 'addColumn', { name: field.name })
      if (updatedQ !== qText) {
        files.push({ path: qpath, content: updatedQ, created: false })
      }
    }

    if (handlerPath) {
      const hText = readFileSync(join(p.root, handlerPath), 'utf8')
      const updatedH = updateHandler(hText, table, 'addColumn', { name: field.name, field })
      if (updatedH !== hText) {
        files.push({ path: handlerPath, content: updatedH, created: false })
      }
    }
    if (field.required && field.type !== 'bool' && field.type !== 'int' && field.type !== 'float') {
      editTest((t) => addKeyToTest(t, urlOf, field.name, sampleOf(field)))
    }

    notes.push(`Added column "${field.name}" (${field.type}) to table "${table}"`)
    if (frontendPage) notes.push(`Frontend: update "${frontendPage}" to include new field "${field.name}" in DataTable/forms`)
  } else if (normSubcmd === 'removeColumn') {
    const colName = args[1]?.toLowerCase()
    if (!colName) throw new Error(`which column? e.g. ducktpl moddb removeColumn ${table} notes`)
    if (colName === 'id') throw new Error(`cannot remove primary key column "id"`)
    if (!info.columns.has(colName)) {
      throw new Error(`column "${colName}" not found on table "${table}" (existing: ${[...info.columns.keys()].join(', ')})`)
    }

    const colInfo = info.columns.get(colName)
    const sqliteType = colInfo.sqliteDef
    const pgType = colInfo.pgDef

    const sqliteMig = `-- +goose Up\nALTER TABLE ${table} DROP COLUMN ${colName};\n\n-- +goose Down\nALTER TABLE ${table} ADD COLUMN ${colName} ${sqliteType};\n`
    const pgMig = `-- +goose Up\nALTER TABLE ${table} DROP COLUMN ${colName};\n\n-- +goose Down\nALTER TABLE ${table} ADD COLUMN ${colName} ${pgType};\n`

    files.push({
      path: `gateway/internal/store/migrations/sqlite/${num}_remove_${colName}_from_${table}.sql`,
      content: sqliteMig,
      created: true,
    })
    files.push({
      path: `gateway/internal/store/migrations/postgres/${num}_remove_${colName}_from_${table}.sql`,
      content: pgMig,
      created: true,
    })

    if (hasQueries) {
      const qText = readFileSync(join(p.root, qpath), 'utf8')
      const updatedQ = updateQueries(qText, table, 'removeColumn', { name: colName })
      if (updatedQ !== qText) {
        files.push({ path: qpath, content: updatedQ, created: false })
      }
    }

    if (handlerPath) {
      const hText = readFileSync(join(p.root, handlerPath), 'utf8')
      const updatedH = updateHandler(hText, table, 'removeColumn', { name: colName })
      if (updatedH !== hText) {
        files.push({ path: handlerPath, content: updatedH, created: false })
      }
    }
    editTest((t) => removeKeyFromTest(t, colName))

    notes.push(`Removed column "${colName}" from table "${table}"`)
    if (frontendPage) notes.push(`Frontend: update "${frontendPage}" to remove references to deleted field "${colName}"`)
  } else if (normSubcmd === 'changeType') {
    if (!opts.force) {
      throw new Error('changeType requires --force because changing a column type may cause data loss or table locks. Pass --force to proceed.')
    }
    const spec = args[1]
    if (!spec) throw new Error(`which column and type? e.g. ducktpl moddb changeType ${table} priority:int! --force`)
    const field = parseField(spec, args[2])
    if (!info.columns.has(field.name)) {
      throw new Error(`column "${field.name}" not found on table "${table}" (existing: ${[...info.columns.keys()].join(', ')})`)
    }

    const oldCol = info.columns.get(field.name)
    const newPgType = colType('pg', { ...field, unique: false })
    const newSqliteType = colType('sqlite', { ...field, unique: false })

    // PostgreSQL wants the type, its default and NOT NULL as separate statements
    const pgParts = (def) => {
      const type = def.replace(/\s+(NOT\s+NULL|NULL|DEFAULT|REFERENCES|UNIQUE|PRIMARY\s+KEY)\b[\s\S]*$/i, '').trim()
      const dflt = /\bDEFAULT\s+('[^']*'|\(.*?\)|\S+)/i.exec(def)?.[1]
      return { type, dflt, notNull: /\bNOT\s+NULL\b/i.test(def) }
    }
    const pgAlter = (col, def) => {
      const { type, dflt, notNull } = pgParts(def)
      const cast = `NULLIF(${col}::text, '')::${type}`
      const using = notNull && dflt ? `COALESCE(${cast}, ${dflt})` : cast
      return [
        `ALTER TABLE ${table} ALTER COLUMN ${col} DROP DEFAULT;`,
        `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE ${type} USING ${using};`,
        ...(dflt ? [`ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT ${dflt};`] : []),
        `ALTER TABLE ${table} ALTER COLUMN ${col} ${notNull ? 'SET' : 'DROP'} NOT NULL;`,
      ].join('\n')
    }
    const pgMig = `-- +goose Up\n${pgAlter(field.name, newPgType)}\n\n-- +goose Down\n${pgAlter(field.name, oldCol.pgDef)}\n`

    // SQLite rebuilds table with PRAGMA foreign_keys and index preservation
    const allCols = [...info.columns.entries()]
    const newColsSqlite = allCols.map(([cname, def]) => {
      if (cname === field.name) return `    ${cname.padEnd(10)} ${newSqliteType}`
      return `    ${cname.padEnd(10)} ${def.sqliteDef}`
    })
    const oldColsSqlite = allCols.map(([cname, def]) => `    ${cname.padEnd(10)} ${def.sqliteDef}`)
    const colListStr = allCols.map(([cname]) => cname).join(', ')
    const recreatedIdxs = info.indexes && info.indexes.length ? '\n' + info.indexes.join('\n') + '\n' : ''

    const sqliteMig = `-- +goose Up
PRAGMA foreign_keys = OFF;
CREATE TABLE ${table}_new (
${newColsSqlite.join(',\n')}
);
INSERT INTO ${table}_new (${colListStr}) SELECT ${colListStr} FROM ${table};
DROP TABLE ${table};
ALTER TABLE ${table}_new RENAME TO ${table};${recreatedIdxs}PRAGMA foreign_keys = ON;

-- +goose Down
PRAGMA foreign_keys = OFF;
CREATE TABLE ${table}_old (
${oldColsSqlite.join(',\n')}
);
INSERT INTO ${table}_old (${colListStr}) SELECT ${colListStr} FROM ${table};
DROP TABLE ${table};
ALTER TABLE ${table}_old RENAME TO ${table};${recreatedIdxs}PRAGMA foreign_keys = ON;
`

    files.push({
      path: `gateway/internal/store/migrations/sqlite/${num}_change_${field.name}_type_in_${table}.sql`,
      content: sqliteMig,
      created: true,
    })
    files.push({
      path: `gateway/internal/store/migrations/postgres/${num}_change_${field.name}_type_in_${table}.sql`,
      content: pgMig,
      created: true,
    })

    if (handlerPath) {
      const hText = readFileSync(join(p.root, handlerPath), 'utf8')
      const updatedH = updateHandler(hText, table, 'changeType', { name: field.name, field })
      if (updatedH !== hText) {
        files.push({ path: handlerPath, content: updatedH, created: false })
      }
    }
    editTest((t) => (t.includes(`"${field.name}":`) ? addKeyToTest(removeKeyFromTest(t, field.name), urlOf, field.name, sampleOf(field)) : t))

    notes.push(`Changed type of "${field.name}" in table "${table}" to ${field.type}`)
    if (frontendPage) notes.push(`Frontend: verify type compatibility of "${field.name}" in "${frontendPage}"`)
  } else if (normSubcmd === 'renameColumn' || normSubcmd === 'renameColum') {
    const oldName = args[1]?.toLowerCase()
    const newName = args[2]?.toLowerCase()
    if (!oldName || !newName) {
      throw new Error(`which columns? e.g. ducktpl moddb ${normSubcmd} ${table} old_name new_name`)
    }
    if (!info.columns.has(oldName)) {
      throw new Error(`column "${oldName}" not found on table "${table}" (existing: ${[...info.columns.keys()].join(', ')})`)
    }
    if (info.columns.has(newName)) {
      throw new Error(`column "${newName}" already exists on table "${table}"`)
    }

    const sqliteMig = `-- +goose Up\nALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName};\n\n-- +goose Down\nALTER TABLE ${table} RENAME COLUMN ${newName} TO ${oldName};\n`
    const pgMig = `-- +goose Up\nALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName};\n\n-- +goose Down\nALTER TABLE ${table} RENAME COLUMN ${newName} TO ${oldName};\n`

    files.push({
      path: `gateway/internal/store/migrations/sqlite/${num}_rename_${oldName}_to_${newName}_in_${table}.sql`,
      content: sqliteMig,
      created: true,
    })
    files.push({
      path: `gateway/internal/store/migrations/postgres/${num}_rename_${oldName}_to_${newName}_in_${table}.sql`,
      content: pgMig,
      created: true,
    })

    if (hasQueries) {
      const qText = readFileSync(join(p.root, qpath), 'utf8')
      const updatedQ = updateQueries(qText, table, 'renameColumn', { oldName, newName })
      if (updatedQ !== qText) {
        files.push({ path: qpath, content: updatedQ, created: false })
      }
    }

    if (handlerPath) {
      const hText = readFileSync(join(p.root, handlerPath), 'utf8')
      const updatedH = updateHandler(hText, table, 'renameColumn', { oldName, newName })
      if (updatedH !== hText) {
        files.push({ path: handlerPath, content: updatedH, created: false })
      }
    }
    // the test sends the column by name too (and other resources' tests seed this one with it)
    editTest((t) => t.replaceAll(`"${oldName}":`, `"${newName}":`))

    notes.push(`Renamed column "${oldName}" to "${newName}" on table "${table}"`)
    if (frontendPage) notes.push(`Frontend: update "${frontendPage}" to rename field "${oldName}" to "${newName}"`)
  }

  return { files, notes, table, action: normSubcmd, frontendPage }
}

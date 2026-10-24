// dto.mjs: inspect and mold DTOs (Data Transfer Objects) for resources in create-duck projects.
//
// Helps shape API response payloads, prevent data leaks (passwords, tokens, internal fields),
// and eliminate unnecessary payload bloat.
//
// Usage:
//   ducktpl dto <resource>                           # inspect DTO vs table columns
//   ducktpl dto <resource> <field1> <field2>...       # specify exact fields in DTO
//   ducktpl dto <resource> --omit <f1,f2>            # omit specific fields from DTO
//   ducktpl dto <resource> --only <f1,f2>            # only include specific fields
//   ducktpl dto <resource> --add <field>             # add a field to DTO
//   ducktpl dto <resource> --remove <field>          # remove a field from DTO
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TYPES, singularize } from './generate.mjs'
import { findTable, inspectTable } from './moddb.mjs'

const pascal = (snake) => snake.split('_').map((w) => (w === 'id' ? 'ID' : w[0].toUpperCase() + w.slice(1))).join('')
const camel = (snake) => {
  const p = pascal(snake)
  return p[0].toLowerCase() + p.slice(1)
}

export function findHandler(root, table) {
  const serverDir = join(root, 'gateway/internal/server')
  if (!existsSync(serverDir)) return null
  const files = readdirSync(serverDir)
  const sing = singularize(table)
  if (files.includes(`${table}.go`)) return join(serverDir, `${table}.go`)
  if (files.includes(`${sing}.go`)) return join(serverDir, `${sing}.go`)
  return null
}

export function parseExistingDTO(handlerText) {
  // 1. Find schema block: // openapi:schema <Name>
  const schemaMatch = /\/\/\s*openapi:schema\s+([A-Za-z0-9_]+)\n[\s\S]*?(?=\ntype\s+)/m.exec(handlerText)
  const schemaName = schemaMatch ? schemaMatch[1] : null
  const schemaBlock = schemaMatch ? schemaMatch[0] : ''

  // 2. Find DTO struct: type <nameDTO> struct { ... }
  const dtoStructMatch = /type\s+([A-Za-z0-9_]+DTO)\s+struct\s*\{([\s\S]*?)\n\}/m.exec(handlerText)
  const dtoname = dtoStructMatch ? dtoStructMatch[1] : null
  const structBody = dtoStructMatch ? dtoStructMatch[2] : ''

  // 3. Find toX func: func toX(...) <nameDTO> { ... }
  const toFuncMatch = /func\s+(to[A-Za-z0-9_]+)\s*\([^)]*?db\.([A-Za-z0-9_]+)\)\s*[A-Za-z0-9_]+DTO\s*\{([\s\S]*?)\n\}/m.exec(handlerText)
  const toFuncName = toFuncMatch ? toFuncMatch[1] : null
  const dbModelName = toFuncMatch ? toFuncMatch[2] : null
  const toFuncBody = toFuncMatch ? toFuncMatch[3] : ''

  // Parse existing fields in DTO
  const fields = new Map() // jsonName -> { goName, goType, jsonName, schemaLine }
  const lines = structBody.split('\n')
  for (const line of lines) {
    const m = /^\s*([A-Za-z0-9_]+)\s+([A-Za-z0-9_.*\[\]]+)\s+`json:"([^"]+)"`/.exec(line)
    if (m) {
      const goName = m[1]
      const goType = m[2]
      const jsonName = m[3]
      // Try to find matching openapi property line
      const propMatch = new RegExp(`^//\\s*${jsonName}:\\s*(.+)$`, 'm').exec(schemaBlock)
      const schemaLine = propMatch ? propMatch[1] : null
      fields.set(jsonName, { goName, goType, jsonName, schemaLine })
    }
  }

  // The mapper's own expression for each field (strPtr(x.AuthorID), x.At.UTC()…):
  // nullable columns need them, and rebuilding them from the Go type loses them.
  const exprs = new Map()
  const lit = /return\s+\w+DTO\{([\s\S]*)\}/.exec(toFuncBody)
  if (lit) {
    for (const item of lit[1].split(/,\s*(?=[A-Z][A-Za-z0-9]*:\s)/)) {
      const m = /^\s*([A-Z][A-Za-z0-9]*):\s*([\s\S]*?)\s*$/.exec(item)
      if (m) exprs.set(m[1], m[2])
    }
  }

  return {
    schemaName,
    schemaBlock,
    exprs,
    dtoname,
    structBody,
    toFuncName,
    dbModelName,
    toFuncBody,
    fields,
  }
}

export function inferFieldType(colName, colDef) {
  const low = (colDef || '').toLowerCase()
  if (colName === 'id') return { goType: 'string', schema: '{ type: string, format: uuid }', toExpr: (arg) => `${arg}.ID` }
  if (colName === 'created_at') return { goType: 'time.Time', schema: '{ type: string, format: date-time }', toExpr: (arg) => `${arg}.CreatedAt.UTC()` }
  if (colName === 'updated_at') return { goType: 'time.Time', schema: '{ type: string, format: date-time }', toExpr: (arg) => `${arg}.UpdatedAt.UTC()` }

  const Go = pascal(colName)

  if (low.includes('int') || low.includes('bigint') || low.includes('serial')) {
    return { goType: 'int64', schema: '{ type: integer, format: int64 }', toExpr: (arg) => `${arg}.${Go}` }
  }
  if (low.includes('bool')) {
    return { goType: 'bool', schema: '{ type: boolean }', toExpr: (arg) => `${arg}.${Go}` }
  }
  if (low.includes('real') || low.includes('double') || low.includes('numeric') || low.includes('float')) {
    return { goType: 'float64', schema: '{ type: number, format: double }', toExpr: (arg) => `${arg}.${Go}` }
  }
  if (low.includes('date') || low.includes('timestamp')) {
    return { goType: 'time.Time', schema: '{ type: string, format: date-time }', toExpr: (arg) => `${arg}.${Go}.UTC()` }
  }
  if (low.includes('json')) {
    return { goType: 'string', schema: '{ type: object }', toExpr: (arg) => `${arg}.${Go}` }
  }
  if (low.includes('blob') || low.includes('bytea')) {
    return { goType: '[]byte', schema: '{ type: string, format: binary }', toExpr: (arg) => `${arg}.${Go}` }
  }

  return { goType: 'string', schema: '{ type: string }', toExpr: (arg) => `${arg}.${Go}` }
}

export function moldHandler(handlerText, tableInfo, selectedFieldNames) {
  const existing = parseExistingDTO(handlerText)
  if (!existing.schemaName || !existing.dtoname || !existing.toFuncName) {
    throw new Error('could not find DTO definition (openapi:schema / DTO struct / toX func) in handler')
  }

  const { schemaName, dtoname, toFuncName, dbModelName } = existing
  const S = schemaName
  const dto = dtoname

  // Filter and order selected fields
  // If 'id' is in table, keep it first; if created_at/updated_at are in table, place at end
  const fieldList = []
  const hasId = selectedFieldNames.has('id')
  const hasCreated = selectedFieldNames.has('created_at')
  const hasUpdated = selectedFieldNames.has('updated_at')

  if (hasId) fieldList.push('id')
  for (const name of selectedFieldNames) {
    if (name !== 'id' && name !== 'created_at' && name !== 'updated_at') {
      fieldList.push(name)
    }
  }
  if (hasCreated) fieldList.push('created_at')
  if (hasUpdated) fieldList.push('updated_at')

  // Build field definitions
  const dtoFieldDefs = []
  for (const name of fieldList) {
    const existingField = existing.fields.get(name)
    const colDef = tableInfo.columns.get(name)?.sqliteDef || ''
    const inferred = inferFieldType(name, colDef)

    const goName = existingField ? existingField.goName : pascal(name)
    const goType = existingField ? existingField.goType : inferred.goType
    const schemaProp = existingField?.schemaLine ? existingField.schemaLine : inferred.schema
    const toExpr = (arg) => {
      if (existingField && existing.exprs.get(goName)) return existing.exprs.get(goName).replaceAll(/\bx\./g, `${arg}.`)
      if (name === 'id') return `${arg}.ID`
      if (name === 'created_at') return `${arg}.CreatedAt.UTC()`
      if (name === 'updated_at') return `${arg}.UpdatedAt.UTC()`
      if (goType === 'time.Time') return `${arg}.${goName}.UTC()`
      if (goType.startsWith('*') || goType.startsWith('sql.Null')) return `${arg}.${goName}`
      return `${arg}.${goName}`
    }

    dtoFieldDefs.push({
      jsonName: name,
      goName,
      goType,
      schemaProp,
      toExpr,
    })
  }

  const w = Math.max(...dtoFieldDefs.map((f) => f.goName.length), 9)
  const tw = Math.max(...dtoFieldDefs.map((f) => f.goType.length), 9)
  const pad = (s) => s.padEnd(w)

  // 1. New schema block
  const newSchemaBlock = `// openapi:schema ${S}
// type: object
// required: [${dtoFieldDefs.map((f) => f.jsonName).join(', ')}]
// properties:
${dtoFieldDefs.map((f) => `//   ${f.jsonName}: ${f.schemaProp}`).join('\n')}`

  // 2. New struct
  const newStruct = `type ${dto} struct {
${dtoFieldDefs.map((f) => `\t${pad(f.goName)} ${f.goType.padEnd(tw)} \`json:"${f.jsonName}"\``).join('\n')}
}`

  // 3. New toX func
  const paramArg = 'x'
  const newToFunc = `func ${toFuncName}(${paramArg} db.${dbModelName}) ${dto} {
\treturn ${dto}{${dtoFieldDefs.map((f) => `${f.goName}: ${f.toExpr(paramArg)}`).join(', ')}}
}`

  // Replace schema block; the match ends before "\ntype", so put back the
  // newline that keeps the blank line openapi-gen needs after the block.
  let updated = handlerText.replace(
    /\/\/\s*openapi:schema\s+[A-Za-z0-9_]+\n[\s\S]*?(?=\ntype\s+[A-Za-z0-9_]+DTO\s+struct)/m,
    () => newSchemaBlock + '\n'
  )

  // Replace struct
  updated = updated.replace(
    /type\s+[A-Za-z0-9_]+DTO\s+struct\s*\{[\s\S]*?\n\}/m,
    newStruct
  )

  // Replace toX func
  updated = updated.replace(
    /func\s+to[A-Za-z0-9_]+\s*\([^)]*?db\.[A-Za-z0-9_]+\)\s*[A-Za-z0-9_]+DTO\s*\{[\s\S]*?\n\}/m,
    newToFunc
  )

  return updated
}

export function planDTO(p, resource, args = [], opts = {}) {
  const table = findTable(p.root, resource)
  const tableInfo = inspectTable(p.root, table)
  const handlerFullPath = findHandler(p.root, table)
  if (!handlerFullPath) {
    throw new Error(`handler for "${resource}" not found in gateway/internal/server/`)
  }

  const handlerRelPath = handlerFullPath.replace(p.root + '/', '')
  const handlerText = readFileSync(handlerFullPath, 'utf8')
  const existing = parseExistingDTO(handlerText)

  const allTableCols = new Set(tableInfo.columns.keys())
  const currentDTOCols = new Set(existing.fields.keys())

  // Inspect mode: no modifying arguments or options passed
  const hasOptions =
    ('only' in opts && opts.only !== undefined) ||
    ('omit' in opts && opts.omit !== undefined) ||
    ('exclude' in opts && opts.exclude !== undefined) ||
    ('add' in opts && opts.add !== undefined) ||
    ('remove' in opts && opts.remove !== undefined)

  const isInspect = args.length === 0 && !hasOptions

  if (isInspect) {
    return {
      inspectOnly: true,
      table,
      schemaName: existing.schemaName,
      dtoname: existing.dtoname,
      handlerPath: handlerRelPath,
      currentDTOCols: [...currentDTOCols],
      allTableCols: [...allTableCols],
      hiddenCols: [...allTableCols].filter((c) => !currentDTOCols.has(c)),
    }
  }

  let targetCols = new Set(currentDTOCols)

  if (opts.only !== undefined && opts.only !== null) {
    const list = opts.only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    targetCols = new Set(list)
  } else if (args.length > 0) {
    targetCols = new Set(args.map((a) => a.trim().toLowerCase()).filter(Boolean))
    // Default to keeping id, created_at, updated_at if in table unless user explicitly specified other columns without them
    if (allTableCols.has('id') && !targetCols.has('id')) targetCols.add('id')
    if (allTableCols.has('created_at') && !targetCols.has('created_at')) targetCols.add('created_at')
    if (allTableCols.has('updated_at') && !targetCols.has('updated_at')) targetCols.add('updated_at')
  }

  if (opts.omit || opts.exclude) {
    const toOmit = (opts.omit || opts.exclude).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    for (const o of toOmit) targetCols.delete(o)
  }

  if (opts.add) {
    const toAdd = opts.add.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    for (const a of toAdd) targetCols.add(a)
  }

  if (opts.remove) {
    const toRemove = opts.remove.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    for (const r of toRemove) targetCols.delete(r)
  }

  if (targetCols.size === 0) {
    throw new Error('cannot have an empty DTO: at least one field must be exposed')
  }

  const updatedCode = moldHandler(handlerText, tableInfo, targetCols)
  const exposed = [...targetCols]
  const hidden = [...allTableCols].filter((c) => !targetCols.has(c))

  const files = [
    {
      path: handlerRelPath,
      content: updatedCode,
      created: false,
    },
  ]

  const notes = [
    `Molded DTO for ${existing.schemaName} (${exposed.length} fields exposed, ${hidden.length} hidden)`,
  ]
  if (hidden.length > 0) {
    notes.push(`Hidden / protected columns (not leaked): ${hidden.join(', ')}`)
  }

  return {
    inspectOnly: false,
    table,
    schemaName: existing.schemaName,
    handlerPath: handlerRelPath,
    exposed,
    hidden,
    files,
    notes,
  }
}

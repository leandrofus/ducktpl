// apply.mjs: declarative schema scaffolding for create-duck projects.
// Supports YAML and JSON schemas defining multiple resources and relationships.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFields, plan, resourceNames } from './generate.mjs'

/**
 * Parses simple YAML or JSON into an object.
 */
export function parseSchemaText(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed)
  }

  // Lightweight YAML parser for resource specs
  const lines = trimmed.split('\n')
  const root = { resources: {} }
  let currentResource = null
  let currentKey = null

  for (let rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Detect fields section
    if (line === 'fields:') {
      currentKey = 'fields'
      continue
    }

    // Detect resource header (e.g. "  tasks:" or "tasks:")
    const resMatch = /^([a-z0-9_]+):\s*$/.exec(line)
    if (resMatch && resMatch[1] !== 'resources') {
      currentResource = resMatch[1]
      root.resources[currentResource] = { fields: [] }
      currentKey = null
      continue
    }

    // Detect scope
    const scopeMatch = /^scope:\s*(true|false)$/i.exec(line)
    if (scopeMatch && currentResource) {
      root.resources[currentResource].scope = scopeMatch[1].toLowerCase() === 'true'
      continue
    }

    const inScopeMatch = /^inScope:\s*([a-z0-9_]+)$/i.exec(line)
    if (inScopeMatch && currentResource) {
      root.resources[currentResource].inScope = inScopeMatch[1]
      continue
    }

    // Detect list item under fields (e.g. "- title:string!")
    const itemMatch = /^-\s+(.+)$/.exec(line)
    if (itemMatch && currentResource && currentKey === 'fields') {
      root.resources[currentResource].fields.push(itemMatch[1].trim())
    }
  }

  return root
}

/**
 * Topologically sorts resources so that referenced tables are generated before
 * referencing tables.
 */
export function sortResourcesTopologically(resourcesObj) {
  const resourceNamesList = Object.keys(resourcesObj)
  const deps = new Map() // resName -> Set(dependencyResNames)

  for (const name of resourceNamesList) {
    const res = resourcesObj[name]
    const list = Array.isArray(res) ? res : res.fields || []
    const depSet = new Set()

    if (res.inScope) {
      depSet.add(res.inScope)
    }

    for (const spec of list) {
      const parts = spec.split(':')
      if (parts[1] === 'ref' && parts[2]) {
        const target = parts[2].replace(/!$/, '')
        if (target !== name && resourceNamesList.includes(target)) {
          depSet.add(target)
        }
      }
    }
    deps.set(name, depSet)
  }

  const sorted = []
  const visited = new Set()
  const visiting = new Set()

  function visit(node) {
    if (visiting.has(node)) {
      throw new Error(`cyclic dependency detected involving resource "${node}"`)
    }
    if (!visited.has(node)) {
      visiting.add(node)
      const depSet = deps.get(node) || new Set()
      for (const d of depSet) {
        visit(d)
      }
      visiting.delete(node)
      visited.add(node)
      sorted.push(node)
    }
  }

  for (const name of resourceNamesList) {
    if (!visited.has(name)) visit(name)
  }

  return sorted
}

/**
 * Plans batch scaffolding for a declarative schema.
 */
export function planApply(p, schemaPathOrContent, opts = {}) {
  let content = schemaPathOrContent
  if (existsSync(schemaPathOrContent)) {
    content = readFileSync(schemaPathOrContent, 'utf8')
  }

  const schema = parseSchemaText(content)
  const resourcesObj = schema.resources || schema
  if (!resourcesObj || typeof resourcesObj !== 'object' || Object.keys(resourcesObj).length === 0) {
    throw new Error('schema must contain a "resources" mapping with at least one resource')
  }

  const orderedNames = sortResourcesTopologically(resourcesObj)
  const allFiles = []
  const allNotes = []
  const plannedSummaries = []

  // Memory overlay so later plans can see earlier planned files (queries, migrations, handlers)
  const virtualFS = new Map()
  const origRead = p.readFile || ((path) => readFileSync(join(p.root, path), 'utf8'))
  const origExists = p.existsSync || ((path) => existsSync(join(p.root, path)))

  const virtualP = {
    ...p,
    readFile: (path) => virtualFS.get(path) ?? origRead(path),
    existsSync: (path) => virtualFS.has(path) || origExists(path),
    listMigrations: (dir) => {
      const disk = existsSync(join(p.root, dir)) ? readdirSync(join(p.root, dir)) : []
      const inMem = [...virtualFS.keys()]
        .filter((k) => k.startsWith(dir + '/'))
        .map((k) => k.replace(dir + '/', ''))
      return [...new Set([...disk, ...inMem])].sort()
    },
  }

  for (const resName of orderedNames) {
    const def = resourcesObj[resName]
    const fieldSpecs = Array.isArray(def) ? def : def.fields || []
    if (!fieldSpecs.length) {
      throw new Error(`resource "${resName}" must have at least one field`)
    }

    const n = resourceNames(resName, def.singular)
    const fields = parseFields(fieldSpecs)

    let cmd = 'add'
    let scope = undefined
    if (def.scope) {
      cmd = 'addScope'
    } else if (def.inScope) {
      cmd = 'addToScope'
      scope = def.inScope
    }

    const extraMigrationFiles = allFiles
      .filter((f) => f.path.includes('migrations/sqlite/'))
      .map((f) => f.path)

    const planned = plan(virtualP, n, fields, { cmd, scope, ...opts, extraMigrationFiles })

    // Merge planned files into virtual overlay
    for (const f of planned.files) {
      virtualFS.set(f.path, f.content)
      const existingIdx = allFiles.findIndex((x) => x.path === f.path)
      if (existingIdx !== -1) {
        allFiles[existingIdx] = f
      } else {
        allFiles.push(f)
      }
    }

    allNotes.push(...planned.notes)
    plannedSummaries.push({
      resource: resName,
      table: n.table,
      action: cmd,
      fieldsCount: fields.length,
    })
  }

  return {
    files: allFiles,
    notes: allNotes,
    resources: plannedSummaries,
  }
}

// apply.mjs: declarative schema scaffolding for create-duck projects.
// Supports YAML and JSON schemas defining multiple resources and relationships.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFields, plan, resourceNames } from './generate.mjs'
import { planObserver } from './observer.mjs'

/**
 * Parses simple YAML or JSON into an object. The YAML subset is block style
 * only; anything it does not understand is an error naming the line, so a
 * manifest never loses modules, fields or pipelines silently.
 */
export function parseSchemaText(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed)
  }

  // Lightweight YAML parser for project blueprint and resource specs
  const lines = trimmed.split('\n')
  const root = { app: {}, resources: {}, pipelines: [] }
  let currentSection = null // 'app' | 'resources' | 'pipelines'
  let currentResource = null
  let currentKey = null
  let currentPipeline = null

  for (const [i, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const where = `line ${i + 1} ("${line}")`
    if (/\s#/.test(line)) throw new Error(`${where}: put comments on their own line, not after a value`)
    if (/:\s*[[{]/.test(line) || /^-\s*[[{]/.test(line)) {
      throw new Error(`${where}: write lists and maps in block style (one "- item" or "key: value" per line), not [a, b] or {k: v}`)
    }

    // Top-level sections
    if (line === 'app:') {
      currentSection = 'app'
      currentKey = null
      continue
    }
    if (line === 'resources:') {
      currentSection = 'resources'
      currentKey = null
      continue
    }
    if (line === 'pipelines:') {
      currentSection = 'pipelines'
      currentKey = null
      continue
    }

    // Pipelines section (e.g. - on: swipes.create, name: matchReciprocal, preset: match_reciprocal, target: matches)
    if (currentSection === 'pipelines') {
      const pItem = /^-\s+(.+)$/.exec(line)
      if (pItem) {
        currentPipeline = {}
        root.pipelines.push(currentPipeline)
        const kv = /^([a-z0-9_]+):\s*(.*)$/.exec(pItem[1])
        if (kv) {
          currentPipeline[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
        }
        continue
      }
      const kv = /^([a-z0-9_]+):\s*(.*)$/.exec(line)
      if (kv && currentPipeline) {
        currentPipeline[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
        continue
      }
    }

    // App Section
    if (currentSection === 'app') {
      const kv = /^([a-z0-9_]+):\s*(.*)$/.exec(line)
      if (kv) {
        const [, k, v] = kv
        if (k === 'modules') {
          root.app.modules = []
          currentKey = 'modules'
        } else if (v) {
          root.app[k] = v.trim().replace(/^['"]|['"]$/g, '')
        }
        continue
      }
      const item = /^-\s+(.+)$/.exec(line)
      if (item && currentKey === 'modules') {
        root.app.modules.push(item[1].trim())
        continue
      }
    }

    // Resources Section
    // Detect fields section
    if (line === 'fields:') {
      currentKey = 'fields'
      continue
    }

    // Detect resource header (e.g. "  tasks:" or "tasks:")
    const resMatch = /^([a-z0-9_]+):\s*$/.exec(line)
    if (resMatch && resMatch[1] !== 'resources' && resMatch[1] !== 'app') {
      currentResource = resMatch[1]
      root.resources[currentResource] = { fields: [] }
      currentKey = null
      currentSection = 'resources'
      continue
    }

    // Detect scope
    const scopeMatch = /^scope:\s*(true|false|[a-z0-9_]+)$/i.exec(line)
    if (scopeMatch && currentResource) {
      const val = scopeMatch[1].toLowerCase()
      if (val === 'true') root.resources[currentResource].scope = true
      else if (val === 'false') root.resources[currentResource].scope = false
      else root.resources[currentResource].inScope = scopeMatch[1]
      continue
    }

    const inScopeMatch = /^inScope:\s*([a-z0-9_]+)$/i.exec(line)
    if (inScopeMatch && currentResource) {
      root.resources[currentResource].inScope = inScopeMatch[1]
      continue
    }

    // Detect ui layout (e.g. ui: cards, ui: feed, ui: chat, ui: table)
    const uiMatch = /^ui:\s*([a-z0-9_]+)$/i.exec(line)
    if (uiMatch && currentResource) {
      root.resources[currentResource].ui = uiMatch[1].toLowerCase()
      continue
    }

    // Detect list item under fields (e.g. "- title:string!")
    const itemMatch = /^-\s+(.+)$/.exec(line)
    if (itemMatch && currentResource && currentKey === 'fields') {
      root.resources[currentResource].fields.push(itemMatch[1].trim())
      continue
    }

    // Detect dict item under fields (e.g. "name: string!" or "status: string!:enum(a,b,c)")
    const colonIdx = line.indexOf(':')
    if (colonIdx !== -1 && currentResource && currentKey === 'fields') {
      const k = line.slice(0, colonIdx).trim()
      const v = line.slice(colonIdx + 1).trim()
      if (/^[a-z0-9_]+$/i.test(k) && v) {
        root.resources[currentResource].fields.push(`${k}:${v}`)
        continue
      }
    }

    throw new Error(`${where}: not understood here (expected app:, resources:, pipelines:, a resource with ui:/scope:/fields:, or a "- name:type" field)`)
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

    const ui = def.ui || opts.ui || 'table'
    const planned = plan(virtualP, n, fields, { cmd, scope, ui, ...opts, extraMigrationFiles })

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
      ui,
      fieldsCount: fields.length,
    })
  }

  // Process declarative pipelines if specified
  const pipelinesList = schema.pipelines || []
  for (const pipe of pipelinesList) {
    const event = pipe.on || pipe.event
    const name = pipe.name || pipe.action || 'pipelineHandler'
    if (!event) continue
    try {
      const plannedObs = planObserver(virtualP, event, name, {
        preset: pipe.preset || 'log',
        pipe: pipe.target ? `${pipe.target}:${pipe.action || 'create'}` : undefined,
        when: pipe.when,
      })
      for (const f of plannedObs.files) {
        virtualFS.set(f.path, f.content)
        const existingIdx = allFiles.findIndex((x) => x.path === f.path)
        if (existingIdx !== -1) {
          allFiles[existingIdx] = f
        } else {
          allFiles.push(f)
        }
      }
      allNotes.push(...plannedObs.notes)
    } catch (e) {
      allNotes.push(`pipeline "${name}" on "${event}" skipped: ${e.message}`)
    }
  }

  return {
    files: allFiles,
    notes: allNotes,
    resources: plannedSummaries,
    pipelines: pipelinesList,
  }
}

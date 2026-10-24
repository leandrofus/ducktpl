#!/usr/bin/env node
// ducktpl: generators for a project made with create-duck.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TYPES, TYPE_ALIASES, applyWithRollback, findProject, inspect, parseFields, plan, resourceNames } from '../lib/generate.mjs'
import { planModdb } from '../lib/moddb.mjs'
import { planDTO } from '../lib/dto.mjs'
import { planApply } from '../lib/apply.mjs'
import { planRemove } from '../lib/remove.mjs'
import { planAction } from '../lib/action.mjs'
import { checkProject } from '../lib/doctor.mjs'
import { listModules, activateModule } from '../lib/modules.mjs'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')

const tty = process.stdout.isTTY
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31)

const isJsonGlobal = process.argv.includes('--json')

const USAGE = `${bold('ducktpl')} — generators for create-duck projects

  ducktpl add <resource> <field:type[!][:modifiers]>... [options]
  ducktpl addScope <resource> <field:type[!]>...
  ducktpl addToScope <scope> <resource> <field:type[!]>...
  ducktpl addAction <resource> <action>
  ducktpl apply <schema-file>
  ducktpl remove <resource>
  ducktpl moddb addColumn <table> <field:type[!]>
  ducktpl moddb removeColumn <table> <column>
  ducktpl moddb changeType <table> <column:type[!]> --force
  ducktpl moddb renameColumn <table> <old_name> <new_name>
  ducktpl dto <resource> [fields...] [options]
  ducktpl module [list|add <name>] [options]
  ducktpl info [options]
  ducktpl check [options]

Adds resources, RPC actions, alters schemas safely, molds DTOs, or applies batch schemas.

  <resource>      plural, lowercase: tasks, work_items
  <scope>         existing scope resource: projects
  <table>         existing table name: notes, tasks
  field:type      types: ${Object.keys(TYPES).join(', ')}; ref: <name>:ref:<resource>; a trailing ! makes it required
  modifiers       :unique, :index, :default(<value>)
  --singular x    when the singular is not the plural minus "s" (people → --singular person)
  --force         required for destructive schema changes like changeType
  --only f1,f2    only include specified fields in the DTO
  --omit f1,f2    omit specified fields from the DTO (prevent leaks)
  --add field     add field to DTO
  --remove field  remove field from DTO
  --dto f1,f2     (for add) specify which fields to expose in the DTO
  --omit-dto f1   (for add) specify which fields to exclude from the DTO
  --json          machine-readable JSON output (ideal for AI agents)
  --no-rollback   disable automatic rollback if build/generation fails
  --dry-run       list what would change, write nothing
  --no-generate   skip make generate

Commands:
  add             regular CRUD resource (supports :unique, :index, :default(...))
  addScope        container resource that other resources can live in
  addToScope      resource that belongs to a scope (nested list, scope picker)
  addAction       generate custom RPC/action endpoint for a resource
  apply           declarative batch schema scaffolding from YAML or JSON file
  remove          safely remove a scaffolded resource and clean up code
  moddb           database schema migrations (addColumn, removeColumn, changeType, renameColumn)
  dto             mold response DTOs, prevent leaking internal fields, reduce output size
  module          list or activate optional features (audit, eventbus, s3, etc.)
  info            inspect project features, available types and existing tables
  check           health check: verify anchors, migrations parity and compilation

Examples:
  ducktpl add tasks title:string! notes:text done:bool priority:int:default(0)
  ducktpl add users email:string!:unique slug:string:index
  ducktpl addAction tasks complete
  ducktpl apply schema.yaml --json
  ducktpl remove tasks --json
  ducktpl check --json
`

function die(msg, code = 'ERR_DUCKTPL', isJson = isJsonGlobal) {
  if (isJson) {
    console.error(JSON.stringify({ status: 'error', error: msg, code }))
  } else {
    console.error(red('✗ ') + msg)
  }
  process.exit(1)
}

function runGeneration(p, opts, rollbackFn) {
  if (!opts.generate) return true

  const run = (label, runCmd, args, cwd) => {
    const r = spawnSync(runCmd, args, { cwd, encoding: 'utf8' })
    if (r.status === 0) {
      if (!opts.json) console.log(green('✓ ') + label)
      return true
    }
    const err = (r.stderr || r.stdout || '').trim().split('\n').slice(-15).join('\n')
    if (!opts.json) {
      console.log(yellow('! ') + label + yellow(' failed:') + '\n' + err)
    }
    return false
  }

  const gw = join(p.root, 'gateway')
  const ok =
    run('sqlc generate', 'make', ['generate'], gw) &&
    run('gofmt', 'gofmt', ['-w', 'internal'], gw) &&
    run('OpenAPI spec', 'go', ['run', './cmd/openapi-gen'], gw) &&
    run('UI types', 'bun', ['run', 'gen-api'], join(p.root, 'web'))

  if (!ok) {
    if (!opts.noRollback && rollbackFn) {
      rollbackFn()
      if (opts.json) {
        console.error(JSON.stringify({
          status: 'error',
          error: 'Post-generation build failed (sqlc, gofmt, openapi-gen, or gen-api). Workspace was automatically rolled back.',
          rolledBack: true,
        }))
      } else {
        console.error(red('✗ Generation failed. Workspace was rolled back to maintain a clean state.'))
      }
      process.exit(1)
    }
    process.exitCode = 1
    return false
  }
  return true
}

function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    if (isJsonGlobal) {
      console.log(JSON.stringify({
        status: 'ok',
        usage: USAGE,
        commands: ['add', 'addScope', 'addToScope', 'addAction', 'apply', 'remove', 'moddb', 'dto', 'info', 'check'],
        types: Object.keys(TYPES),
      }, null, 2))
      return
    }
    return console.log(USAGE)
  }

  const opts = {
    dry: false,
    generate: true,
    force: false,
    singular: '',
    only: undefined,
    omit: undefined,
    exclude: undefined,
    add: undefined,
    remove: undefined,
    dto: '',
    dtoOmit: '',
    json: isJsonGlobal,
    noRollback: false,
  }

  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dry = true
    else if (a === '--no-generate') opts.generate = false
    else if (a === '--force') opts.force = true
    else if (a === '--json') opts.json = true
    else if (a === '--no-rollback') opts.noRollback = true
    else if (a === '--singular') opts.singular = argv[++i] ?? die('--singular needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--only') opts.only = argv[++i] ?? die('--only needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--omit') opts.omit = argv[++i] ?? die('--omit needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--exclude') opts.exclude = argv[++i] ?? die('--exclude needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--add') opts.add = argv[++i] ?? die('--add needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--remove') opts.remove = argv[++i] ?? die('--remove needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--dto') opts.dto = argv[++i] ?? die('--dto needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--omit-dto') opts.dtoOmit = argv[++i] ?? die('--omit-dto needs a value', 'ERR_ARGS', opts.json)
    else if (a === '--addRoute' || a === '--add-route') rest.push('add')
    else if (a === '--addScope' || a === '--add-scope') rest.push('addScope')
    else if (a === '--addToScope' || a === '--add-to-scope') rest.push('addToScope')
    else if (a.startsWith('-')) die(`unknown option ${a}\n\n${USAGE}`, 'ERR_UNKNOWN_OPT', opts.json)
    else rest.push(a)
  }

  let cmd = rest[0]

  let p
  try {
    p = inspect(findProject(process.cwd()))
  } catch (e) {
    die(e.message, 'ERR_NOT_PROJECT', opts.json)
  }

  // 1. Info / Inspect Command
  if (cmd === 'info' || cmd === 'inspect') {
    const sqliteDir = join(p.root, 'gateway/internal/store/migrations/sqlite')
    const tables = []
    if (existsSync(sqliteDir)) {
      for (const f of readdirSync(sqliteDir)) {
        if (!f.endsWith('.sql')) continue
        const text = readFileSync(join(sqliteDir, f), 'utf8')
        const matches = text.matchAll(/CREATE\s+TABLE\s+([a-z0-9_]+)/gi)
        for (const m of matches) tables.push(m[1])
      }
    }

    const payload = {
      status: 'ok',
      action: 'info',
      project: {
        root: p.root,
        module: p.module,
        features: {
          auth: p.auth,
          rbac: p.rbac,
          live: p.live,
          multitenant: p.multitenant,
        },
      },
      types: Object.keys(TYPES),
      typeAliases: TYPE_ALIASES,
      tables: [...new Set(tables)],
      anchors: [
        'ducktpl:routes',
        'ducktpl:perms',
        'ducktpl:catalog',
        'ducktpl:user-perms',
        'ducktpl:objects',
        'ducktpl:imports',
        'ducktpl:nav',
        'ducktpl:pages',
        'ducktpl:live',
        'ducktpl:scope-links',
      ],
    }

    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2))
    } else {
      console.log(bold('duck-template project info:'))
      console.log(`  Root: ${p.root}`)
      console.log(`  Module: ${p.module}`)
      console.log(`  Features: ${Object.entries(payload.project.features).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`)
      console.log(`  Existing tables: ${payload.tables.join(', ') || 'none'}`)
      console.log(`  Available types: ${payload.types.join(', ')}`)
    }
    return
  }

  // 2. Health Check / Doctor Command
  if (cmd === 'check' || cmd === 'doctor') {
    const res = checkProject(p, opts)
    if (opts.json) {
      console.log(JSON.stringify({ status: res.healthy ? 'ok' : 'error', ...res }, null, 2))
    } else {
      console.log(bold('Health Check for DuckApp:'))
      for (const ok of res.passed) console.log(`  ${green('✓')} ${ok}`)
      for (const err of res.issues) console.log(`  ${red('✗')} ${err.message}`)
      console.log(res.healthy ? `\n${green('All checks passed.')}` : `\n${red('Issues detected.')}`)
    }
    if (!res.healthy) process.exitCode = 1
    return
  }

  // 2b. Optional Modules Command (list, add)
  if (cmd === 'module' || cmd === 'modules') {
    const sub = rest[1]
    if (!sub || sub === 'list') {
      const mods = listModules(p)
      if (opts.json) {
        console.log(JSON.stringify({ status: 'ok', action: 'module', modules: mods }, null, 2))
      } else {
        console.log(bold('Optional modules for duck-template:'))
        for (const m of mods) {
          const badge = m.active ? green('[active]') : dim('[inactive]')
          const reqs = m.requires?.length ? dim(` (needs ${m.requires.join(', ')})`) : ''
          console.log(`  ${badge} ${bold(m.id.padEnd(10))} ${m.label} — ${dim(m.hint)}${reqs}`)
        }
      }
      return
    }

    if (sub === 'add' || sub === 'enable') {
      const targetMod = rest[2]
      if (!targetMod) die('which module to add? e.g. ducktpl module add audit', 'ERR_ARGS', opts.json)
      try {
        const res = activateModule(p, TEMPLATE, targetMod, opts)
        if (opts.json) {
          console.log(JSON.stringify({ status: 'ok', action: 'module:add', ...res }, null, 2))
        } else {
          if (res.alreadyActive) {
            console.log(yellow(`Module "${targetMod}" is already active.`))
          } else {
            console.log(green(`✓ Activated module "${targetMod}" (${res.label})`))
            for (const f of res.filesAdded) console.log(`  ${green('create/update')} ${f}`)
          }
        }
      } catch (e) {
        die(e.message, 'ERR_MODULE_FAILED', opts.json)
      }
      return
    }

    die(`unknown module subcommand "${sub}" (valid: list, add <name>)`, 'ERR_ARGS', opts.json)
  }

  // 3. Declarative Schema Apply Command
  if (cmd === 'apply') {
    const schemaFile = rest[1]
    if (!schemaFile) die('which schema file? e.g. ducktpl apply schema.yaml', 'ERR_ARGS', opts.json)
    let planned
    try {
      planned = planApply(p, schemaFile, opts)
    } catch (e) {
      die(e.message, 'ERR_APPLY_FAILED', opts.json)
    }

    if (opts.dry) {
      if (opts.json) {
        console.log(JSON.stringify({
          status: 'ok',
          dryRun: true,
          action: 'apply',
          resources: planned.resources,
          files: planned.files.map((f) => ({ path: f.path, action: f.created ? 'create' : 'update' })),
          notes: planned.notes,
        }, null, 2))
      } else {
        console.log(`${bold('Applying schema')} ${dim(`(${planned.resources.length} resources)`)}`)
        for (const f of planned.files) console.log(`  ${f.created ? green('create') : yellow('update')} ${f.path}`)
        console.log(dim('\n--dry-run: nothing written'))
      }
      return
    }

    const res = applyWithRollback(p.root, planned.files)
    const generatedOk = runGeneration(p, opts, () => res.rollback())

    if (opts.json) {
      console.log(JSON.stringify({
        status: 'ok',
        action: 'apply',
        resources: planned.resources,
        files: planned.files.map((f) => ({ path: f.path, action: f.created ? 'create' : 'update' })),
        notes: planned.notes,
        generated: generatedOk,
      }, null, 2))
    } else {
      console.log(`\n${green('Done.')} Applied ${planned.resources.length} resources successfully.`)
    }
    return
  }

  // 4. Remove / Destroy Resource Command
  if (cmd === 'remove' || cmd === 'destroy') {
    const targetResource = rest[1]
    if (!targetResource) die('which resource to remove? e.g. ducktpl remove tasks', 'ERR_ARGS', opts.json)
    let planned
    try {
      planned = planRemove(p, targetResource, opts)
    } catch (e) {
      die(e.message, 'ERR_REMOVE_FAILED', opts.json)
    }

    if (opts.dry) {
      if (opts.json) {
        console.log(JSON.stringify({
          status: 'ok',
          dryRun: true,
          action: 'remove',
          resource: targetResource,
          filesToDelete: planned.filesToDelete,
          filesToPatch: planned.filesToPatch.map((f) => f.path),
          notes: planned.notes,
        }, null, 2))
      } else {
        console.log(`${bold('Removing resource')} ${targetResource}`)
        for (const f of planned.filesToDelete) console.log(`  ${red('delete')} ${f}`)
        for (const f of planned.filesToPatch) console.log(`  ${yellow('patch')} ${f.path}`)
        console.log(dim('\n--dry-run: nothing changed'))
      }
      return
    }

    // Backup files to patch
    const backups = []
    for (const f of planned.filesToPatch) {
      const full = join(p.root, f.path)
      if (existsSync(full)) backups.push({ path: full, content: readFileSync(full, 'utf8') })
    }

    // Execute deletion and patches
    for (const f of planned.filesToDelete) {
      const full = join(p.root, f)
      if (existsSync(full)) rmSync(full, { force: true })
    }
    for (const f of planned.filesToPatch) {
      writeFileSync(join(p.root, f.path), f.content, 'utf8')
    }

    const generatedOk = runGeneration(p, opts, () => {
      for (const b of backups) writeFileSync(b.path, b.content, 'utf8')
    })

    if (opts.json) {
      console.log(JSON.stringify({
        status: 'ok',
        action: 'remove',
        resource: targetResource,
        deleted: planned.filesToDelete,
        patched: planned.filesToPatch.map((f) => f.path),
        notes: planned.notes,
        generated: generatedOk,
      }, null, 2))
    } else {
      console.log(`\n${green('Done.')} Removed resource "${targetResource}".`)
    }
    return
  }

  // 5. Add Custom Action / RPC Command
  if (cmd === 'addAction' || cmd === 'add-action') {
    const targetResource = rest[1]
    const actionName = rest[2]
    if (!targetResource || !actionName) die('which resource and action? e.g. ducktpl addAction tasks complete', 'ERR_ARGS', opts.json)
    let planned
    try {
      planned = planAction(p, targetResource, actionName, opts)
    } catch (e) {
      die(e.message, 'ERR_ACTION_FAILED', opts.json)
    }

    if (opts.dry) {
      if (opts.json) {
        console.log(JSON.stringify({
          status: 'ok',
          dryRun: true,
          action: 'addAction',
          resource: targetResource,
          actionName,
          route: planned.route,
          files: planned.files.map((f) => ({ path: f.path, action: f.created ? 'create' : 'update' })),
          notes: planned.notes,
        }, null, 2))
      } else {
        console.log(`${bold('Adding action')} ${actionName} to ${targetResource}`)
        for (const f of planned.files) console.log(`  ${f.created ? green('create') : yellow('update')} ${f.path}`)
        console.log(dim('\n--dry-run: nothing written'))
      }
      return
    }

    const res = applyWithRollback(p.root, planned.files)
    const generatedOk = runGeneration(p, opts, () => res.rollback())

    if (opts.json) {
      console.log(JSON.stringify({
        status: 'ok',
        action: 'addAction',
        resource: targetResource,
        actionName,
        route: planned.route,
        files: planned.files.map((f) => ({ path: f.path, action: f.created ? 'create' : 'update' })),
        notes: planned.notes,
        generated: generatedOk,
      }, null, 2))
    } else {
      console.log(`\n${green('Done.')} Action "${actionName}" added on ${planned.route}.`)
    }
    return
  }

  let subcmd = null
  let subargs = []
  if (cmd?.startsWith('moddb:')) {
    subcmd = cmd.slice(6)
    cmd = 'moddb'
    subargs = rest.slice(1)
  } else if (cmd === 'moddb') {
    subcmd = rest[1]
    subargs = rest.slice(2)
    if (!subcmd) die(`which moddb command? e.g. ducktpl moddb addColumn tasks notes:text\n\n${USAGE}`, 'ERR_ARGS', opts.json)
  }

  let resource, scope, specs
  if (cmd === 'add' || cmd === 'addScope') {
    resource = rest[1]
    specs = rest.slice(2)
    if (!resource) die(`which resource? e.g. ducktpl ${cmd} ${cmd === 'addScope' ? 'projects' : 'tasks'} title:string!`, 'ERR_ARGS', opts.json)
  } else if (cmd === 'addToScope') {
    scope = rest[1]
    resource = rest[2]
    specs = rest.slice(3)
    if (!scope || !resource) die('which scope and resource? e.g. ducktpl addToScope projects tasks title:string!', 'ERR_ARGS', opts.json)
  } else if (cmd === 'dto') {
    resource = rest[1]
    specs = rest.slice(2)
    if (!resource) die('which resource? e.g. ducktpl dto notes [fields...]', 'ERR_ARGS', opts.json)
  } else if (cmd !== 'moddb') {
    die(`unknown command ${cmd ?? ''}\n\n${USAGE}`, 'ERR_UNKNOWN_CMD', opts.json)
  }

  let n, fields, planned
  try {
    if (cmd === 'moddb') {
      planned = planModdb(p, subcmd, subargs, opts)
    } else if (cmd === 'dto') {
      planned = planDTO(p, resource, specs, opts)
    } else {
      n = resourceNames(resource, opts.singular)
      fields = parseFields(specs)
      planned = plan(p, n, fields, { cmd, scope, ...opts })
    }
  } catch (e) {
    die(e.message, 'ERR_PLAN_FAILED', opts.json)
  }

  if (cmd === 'dto' && planned.inspectOnly) {
    if (opts.json) {
      console.log(JSON.stringify({
        status: 'ok',
        action: 'dto_inspect',
        table: planned.table,
        schemaName: planned.schemaName,
        handlerPath: planned.handlerPath,
        exposed: planned.currentDTOCols,
        hidden: planned.hiddenCols,
      }, null, 2))
      return
    }
    console.log(`${bold('DTO for')} ${planned.schemaName} ${dim(`(table ${planned.table}, handler ${planned.handlerPath})`)}`)
    console.log(`\n  ${bold('Exposed fields in DTO:')}`)
    for (const c of planned.currentDTOCols) console.log(`    ${green('✓')} ${c}`)
    console.log(`\n  ${bold('Hidden / protected table columns:')}`)
    if (planned.hiddenCols.length === 0) {
      console.log(`    ${dim('(none — all columns are currently exposed in DTO)')}`)
    } else {
      for (const c of planned.hiddenCols) console.log(`    ${yellow('✗')} ${c} ${dim('(not leaked)')}`)
    }
    console.log(`\n${dim('To shape DTO:')} ducktpl dto ${resource} <fields...> or ducktpl dto ${resource} --omit <fields...>`)
    return
  }

  const { files, notes = [] } = planned

  if (opts.dry) {
    if (opts.json) {
      console.log(JSON.stringify({
        status: 'ok',
        dryRun: true,
        action: cmd,
        table: planned.table || n?.table,
        files: files.map((f) => ({ path: f.path, action: f.created ? 'create' : 'update' })),
        notes,
        frontendPage: planned.frontendPage || undefined,
      }, null, 2))
      return
    }
  }

  if (!opts.json) {
    if (cmd === 'moddb') {
      console.log(`${bold('Modifying')} database ${dim(`(table ${planned.table}, moddb ${planned.action})`)}`)
    } else if (cmd === 'dto') {
      console.log(`${bold('Molding DTO for')} ${planned.schemaName} ${dim(`(table ${planned.table}, handler ${planned.handlerPath})`)}`)
      console.log(`  Exposed in DTO: ${planned.exposed.join(', ')}`)
      if (planned.hidden.length) console.log(dim(`  Hidden from API: ${planned.hidden.join(', ')}`))
    } else {
      const mods = ['auth', 'rbac', 'live', 'multitenant'].filter((m) => p[m])
      const kind = cmd === 'addScope' ? 'scope ' : cmd === 'addToScope' ? `resource in ${scope}: ` : ''
      console.log(`${bold('Adding')} ${kind}${n.label} ${dim(`(${n.url}, model ${n.Singular}; project modules: ${mods.join(', ') || 'none'})`)}`)
    }

    for (const f of files) console.log(`  ${f.created ? green('create') : yellow('update')} ${f.path}`)
    for (const note of notes) console.log(`  ${yellow('! ' + note)}`)
  }

  if (opts.dry) {
    return console.log(dim('\n--dry-run: nothing written'))
  }

  const res = applyWithRollback(p.root, files)
  const generatedOk = runGeneration(p, opts, () => res.rollback())

  if (opts.json) {
    console.log(JSON.stringify({
      status: 'ok',
      action: cmd,
      subcommand: subcmd || undefined,
      resource: resource || undefined,
      table: planned.table || n?.table,
      files: files.map((f) => ({ path: f.path, action: f.created ? 'create' : 'update' })),
      notes,
      frontendPage: planned.frontendPage || undefined,
      generated: generatedOk,
    }, null, 2))
    return
  }

  if (cmd === 'moddb') {
    console.log(`\n${green('Done.')} ${dim('Try it:')} make test`)
  } else if (cmd === 'dto') {
    console.log(`\n${green('Done.')} ${dim('DTO updated: prevents data leaks and reduces API payload.')}`)
  } else {
    console.log(`\n${green('Done.')} ${dim('Try it:')} make test, then make dev and open ${n.label} in the sidebar.\n${dim('The generated handler and page are plain code: add validation in check' + n.Singular + ', columns, a drawer…')}`)
  }
}

main()

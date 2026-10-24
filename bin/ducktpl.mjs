#!/usr/bin/env node
// ducktpl: generators for a project made with create-duck.
//
//   npx ducktpl add tasks title:string! done:bool priority:int
//   npx ducktpl addScope projects name:string!
//   npx ducktpl addToScope projects tasks title:string!
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { TYPES, apply, findProject, inspect, parseFields, plan, resourceNames } from '../lib/generate.mjs'
import { planModdb } from '../lib/moddb.mjs'
import { planDTO } from '../lib/dto.mjs'

const tty = process.stdout.isTTY
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31)

const USAGE = `${bold('ducktpl')} — generators for create-duck projects

  ducktpl add <resource> <field:type[!]>... [options]
  ducktpl addScope <resource> <field:type[!]>...
  ducktpl addToScope <scope> <resource> <field:type[!]>...
  ducktpl --addRoute <resource> <field:type[!]>...
  ducktpl moddb addColumn <table> <field:type[!]>
  ducktpl moddb removeColumn <table> <column>
  ducktpl moddb changeType <table> <column:type[!]> --force
  ducktpl moddb renameColumn <table> <old_name> <new_name>
  ducktpl dto <resource> [fields...] [options]

Adds a resource through every layer: migrations (SQLite and PostgreSQL),
queries, handlers with their OpenAPI blocks, routes, permissions (auth,
rbac), an HTTP test, a web page and its nav entry; modifies database schema
safely (moddb); or molds response DTOs to avoid data leaks and minimize payloads (dto).

  <resource>      plural, lowercase: tasks, work_items
  <scope>         existing scope resource: projects
  <table>         existing table name: notes, tasks
  field:type      types: ${Object.keys(TYPES).join(', ')}; ref: <name>:ref:<resource>; a trailing ! makes it required
  --singular x    when the singular is not the plural minus "s" (people → --singular person)
  --force         required for destructive schema changes like changeType
  --only f1,f2    only include specified fields in the DTO
  --omit f1,f2    omit specified fields from the DTO (prevent leaks)
  --add field     add field to DTO
  --remove field  remove field from DTO
  --dto f1,f2     (for add) specify which fields to expose in the DTO
  --omit-dto f1   (for add) specify which fields to exclude from the DTO
  --dry-run       list what would change, write nothing
  --no-generate   skip make generate

Commands:
  add             regular CRUD resource
  addScope        container resource that other resources can live in
  addToScope      resource that belongs to a scope (nested list, scope picker)
  moddb           database schema migrations (addColumn, removeColumn, changeType, renameColumn)
  dto             mold response DTOs, prevent leaking internal fields, reduce output size

Examples:
  ducktpl add tasks title:string! notes:text done:bool priority:int
  ducktpl addScope projects name:string!
  ducktpl addToScope projects tasks title:string!
  ducktpl moddb addColumn notes status:string!
  ducktpl moddb removeColumn notes pinned
  ducktpl moddb changeType notes priority:int! --force
  ducktpl moddb renameColumn notes title heading
  ducktpl dto notes                           # inspect current DTO fields vs table columns
  ducktpl dto notes title body                # only expose title and body in DTO (hides pinned)
  ducktpl dto notes --omit pinned             # omit pinned from DTO response
`

function die(msg) {
  console.error(red('✗ ') + msg)
  process.exit(1)
}

function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) return console.log(USAGE)
  const opts = { dry: false, generate: true, force: false, singular: '', only: '', omit: '', exclude: '', add: '', remove: '', dto: '', dtoOmit: '' }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dry = true
    else if (a === '--no-generate') opts.generate = false
    else if (a === '--force') opts.force = true
    else if (a === '--singular') opts.singular = argv[++i] ?? die('--singular needs a value')
    else if (a === '--only') opts.only = argv[++i] ?? die('--only needs a value')
    else if (a === '--omit') opts.omit = argv[++i] ?? die('--omit needs a value')
    else if (a === '--exclude') opts.exclude = argv[++i] ?? die('--exclude needs a value')
    else if (a === '--add') opts.add = argv[++i] ?? die('--add needs a value')
    else if (a === '--remove') opts.remove = argv[++i] ?? die('--remove needs a value')
    else if (a === '--dto') opts.dto = argv[++i] ?? die('--dto needs a value')
    else if (a === '--omit-dto') opts.dtoOmit = argv[++i] ?? die('--omit-dto needs a value')
    else if (a === '--addRoute' || a === '--add-route') rest.push('add')
    else if (a === '--addScope' || a === '--add-scope') rest.push('addScope')
    else if (a === '--addToScope' || a === '--add-to-scope') rest.push('addToScope')
    else if (a.startsWith('-')) die(`unknown option ${a}\n\n${USAGE}`)
    else rest.push(a)
  }
  let cmd = rest[0]
  let subcmd = null
  let subargs = []
  if (cmd?.startsWith('moddb:')) {
    subcmd = cmd.slice(6)
    cmd = 'moddb'
    subargs = rest.slice(1)
  } else if (cmd === 'moddb') {
    subcmd = rest[1]
    subargs = rest.slice(2)
    if (!subcmd) die(`which moddb command? e.g. ducktpl moddb addColumn tasks notes:text\n\n${USAGE}`)
  }

  let resource, scope, specs
  if (cmd === 'add' || cmd === 'addScope') {
    resource = rest[1]
    specs = rest.slice(2)
    if (!resource) die(`which resource? e.g. ducktpl ${cmd} ${cmd === 'addScope' ? 'projects' : 'tasks'} title:string!`)
  } else if (cmd === 'addToScope') {
    scope = rest[1]
    resource = rest[2]
    specs = rest.slice(3)
    if (!scope || !resource) die('which scope and resource? e.g. ducktpl addToScope projects tasks title:string!')
  } else if (cmd === 'dto') {
    resource = rest[1]
    specs = rest.slice(2)
    if (!resource) die('which resource? e.g. ducktpl dto notes [fields...]')
  } else if (cmd !== 'moddb') {
    die(`unknown command ${cmd ?? ''}\n\n${USAGE}`)
  }

  let p, n, fields, planned
  try {
    p = inspect(findProject(process.cwd()))
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
    die(e.message)
  }

  if (cmd === 'dto' && planned.inspectOnly) {
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
  if (opts.dry) return console.log(dim('\n--dry-run: nothing written'))
  apply(p.root, files)

  if (opts.generate) {
    const run = (label, cmd, args, cwd) => {
      const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
      if (r.status === 0) return console.log(green('✓ ') + label), true
      console.log(yellow('! ') + label + yellow(' failed:') + '\n' + (r.stderr || r.stdout).trim().split('\n').slice(-15).join('\n'))
      return false
    }
    const gw = join(p.root, 'gateway')
    const ok =
      run('sqlc generate', 'make', ['generate'], gw) &&
      run('gofmt', 'gofmt', ['-w', 'internal'], gw) &&
      run('OpenAPI spec', 'go', ['run', './cmd/openapi-gen'], gw) &&
      run('UI types', 'bun', ['run', 'gen-api'], join(p.root, 'web'))
    if (!ok) process.exitCode = 1
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

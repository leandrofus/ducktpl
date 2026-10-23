#!/usr/bin/env node
// ducktpl: generators for a project made with create-duck.
//
//   npx ducktpl add tasks title:string! done:bool priority:int
//   npx ducktpl --addRoute tasks title:string!          (same)
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { TYPES, apply, findProject, inspect, parseFields, plan, resourceNames } from '../lib/generate.mjs'

const tty = process.stdout.isTTY
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31)

const USAGE = `${bold('ducktpl')} — generators for create-duck projects

  ducktpl add <resource> <field:type[!]>... [options]
  ducktpl --addRoute <resource> <field:type[!]>...

Adds a resource through every layer: migrations (SQLite and PostgreSQL),
queries, handlers with their OpenAPI blocks, routes, permissions (auth,
rbac), an HTTP test, a web page and its nav entry; then regenerates sqlc
code, the spec and the UI types.

  <resource>    plural, lowercase: tasks, work_items
  field:type    types: ${Object.keys(TYPES).join(', ')}; a trailing ! makes it required
  --singular x  when the singular is not the plural minus "s" (people → --singular person)
  --dry-run     list what would change, write nothing
  --no-generate skip make generate

Example:
  ducktpl add tasks title:string! notes:text done:bool priority:int
`

function die(msg) {
  console.error(red('✗ ') + msg)
  process.exit(1)
}

function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) return console.log(USAGE)
  const opts = { dry: false, generate: true, singular: '' }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dry = true
    else if (a === '--no-generate') opts.generate = false
    else if (a === '--singular') opts.singular = argv[++i] ?? die('--singular needs a value')
    else if (a === '--addRoute' || a === '--add-route') rest.push('add')
    else if (a.startsWith('-')) die(`unknown option ${a}\n\n${USAGE}`)
    else rest.push(a)
  }
  const [cmd, resource, ...specs] = rest
  if (cmd !== 'add') die(`unknown command ${cmd ?? ''}\n\n${USAGE}`)
  if (!resource) die('which resource? e.g. ducktpl add tasks title:string!')

  let p, n, fields, files
  try {
    p = inspect(findProject(process.cwd()))
    n = resourceNames(resource, opts.singular)
    fields = parseFields(specs)
    files = plan(p, n, fields)
  } catch (e) {
    die(e.message)
  }
  const mods = ['auth', 'rbac', 'live'].filter((m) => p[m])
  console.log(`${bold('Adding')} ${n.label} ${dim(`(${n.url}, model ${n.Singular}; project modules: ${mods.join(', ') || 'none'})`)}`)
  for (const f of files) console.log(`  ${f.created ? green('create') : yellow('update')} ${f.path}`)
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
  console.log(`
${green('Done.')} ${dim('Try it:')} make test, then make dev and open ${n.label} in the sidebar.
${dim('The generated handler and page are plain code: add validation in check' + n.Singular + ', columns, a drawer…')}`)
}

main()

#!/usr/bin/env node
// create-duck: scaffolds a duck-family app (Go gateway + embedded web UI,
// OpenAPI contract from code, SQLite/PostgreSQL) with the modules you pick.
//
//   bunx create-duck my-app            interactive
//   npx create-duck my-app --web preact --with auth,rbac,sse --yes
//   create-duck --check                validate the template (for its CI)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { FEATURES, WEBS, configure } from '../lib/features.mjs'
import { check, isEmptyDir, names, removeEmptyDirs, scaffold } from '../lib/scaffold.mjs'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')
const tty = process.stdout.isTTY
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31), cyan = c(36)

const USAGE = `${bold('create-duck')} <name> [options]

  --web react|preact     web framework (default react)
  --with a,b,c           modules (see below); "all" for every one
  --owner <github-user>  Go module path github.com/<owner>/<name> (default: git config github.user)
  --yes, -y              no questions: defaults for what is not given
  --no-install           skip go mod tidy, code generation, bun install and git init
  --check                validate the template's markers and exit

Modules:
${FEATURES.map((f) => `  ${f.id.padEnd(7)} ${f.label} — ${dim(f.hint)}${f.requires ? dim(` (needs ${f.requires.join(', ')})`) : ''}`).join('\n')}
`

function parseArgs(argv) {
  const a = { with: null, web: null, owner: null, yes: false, install: true, check: false, name: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    const val = () => argv[++i] ?? die(`${x} needs a value`)
    if (x === '--with') a.with = val()
    else if (x.startsWith('--with=')) a.with = x.slice(7)
    else if (x === '--web') a.web = val()
    else if (x.startsWith('--web=')) a.web = x.slice(6)
    else if (x === '--owner') a.owner = val()
    else if (x.startsWith('--owner=')) a.owner = x.slice(8)
    else if (x === '--yes' || x === '-y') a.yes = true
    else if (x === '--no-install') a.install = false
    else if (x === '--check') a.check = true
    else if (x === '--help' || x === '-h') a.help = true
    else if (x.startsWith('-')) die(`unknown option ${x}`)
    else if (!a.name) a.name = x
    else die(`unexpected argument ${x}`)
  }
  return a
}

function die(msg) {
  console.error(red('✗ ') + msg)
  process.exit(1)
}

function run(cmd, args, cwd, { quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' })
  return r.status === 0
}

const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0 || spawnSync(cmd, ['version'], { stdio: 'ignore' }).status === 0

function gitConfig(key) {
  const r = spawnSync('git', ['config', '--get', key], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

async function ask(args) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    if (!args.name) args.name = (await rl.question(`${cyan('?')} Project name: `)).trim()
    if (!args.web) {
      console.log(`${cyan('?')} Web framework:`)
      WEBS.forEach((w, i) => console.log(`  ${i + 1}) ${w.label}`))
      const x = (await rl.question(dim('  [1] ') )).trim()
      args.web = WEBS[(parseInt(x) || 1) - 1]?.id ?? die(`no option ${x}`)
    }
    if (args.with === null) {
      console.log(`${cyan('?')} Modules (numbers or names, comma-separated; enter for none):`)
      FEATURES.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}) ${f.label.padEnd(22)} ${dim(f.hint)}`))
      const x = (await rl.question('  > ')).trim()
      args.with = x
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((t) => (/^\d+$/.test(t) ? FEATURES[+t - 1]?.id ?? die(`no module ${t}`) : t))
        .join(',')
    }
    if (!args.owner) {
      const def = gitConfig('github.user') || 'leandrofus'
      args.owner = (await rl.question(`${cyan('?')} GitHub owner for the Go module ${dim(`[${def}]`)}: `)).trim() || def
    }
  } finally {
    rl.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(USAGE)
  if (args.check) {
    const n = check(TEMPLATE)
    return console.log(green('✓ ') + `${n} template files follow the marker rules`)
  }
  if (!args.yes && process.stdin.isTTY) await ask(args)
  args.web ??= 'react'
  args.owner ??= gitConfig('github.user') || 'leandrofus'
  if (!args.name) die('a project name is required\n\n' + USAGE)
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(args.name)) die('the name must be lowercase letters, digits and dashes, starting with a letter')
  const ids = args.with === 'all' ? FEATURES.map((f) => f.id) : (args.with || '').split(',').map((s) => s.trim()).filter(Boolean)
  let cfg
  try {
    cfg = configure(ids, args.web)
  } catch (e) {
    die(e.message)
  }
  const dest = resolve(args.name)
  if (!isEmptyDir(dest)) die(`${dest} exists and is not empty`)
  mkdirSync(dest, { recursive: true })

  const n = names(args.name, args.owner)
  const on = FEATURES.filter((f) => cfg[f.id]).map((f) => f.id)
  console.log(`\n${bold('Creating')} ${n.display} in ${dest}`)
  console.log(dim(`  web: ${args.web} · modules: ${on.join(', ') || 'none'} · module: ${n.module}/gateway\n`))
  const files = scaffold(TEMPLATE, dest, cfg, n)
  removeEmptyDirs(dest)
  console.log(green('✓ ') + `${files.length} files`)

  if (args.install) postInstall(dest, cfg)

  console.log(`
${green('Done.')} Next:

  cd ${args.name}
  make dev        ${dim('# gateway on :8080 + Vite with hot reload on :5173')}
  make build      ${dim('# one binary with the UI inside: dist/bin/' + n.lower)}
  make help       ${dim('# everything else')}

${dim('Add an endpoint: migration + query → handler with its openapi:operation → route → make generate. See CLAUDE.md.')}
`)
}

function postInstall(dest, cfg) {
  const step = (label, ok) => console.log((ok ? green('✓ ') : yellow('! ')) + label + (ok ? '' : yellow(' (failed; run it yourself)')))
  const gw = join(dest, 'gateway')
  if (has('go')) {
    step('go mod tidy', run('go', ['mod', 'tidy'], gw, { quiet: true }))
    // sqlc regenerates package db for the chosen tables (downloads sqlc once).
    step('sqlc generate', run('make', ['generate'], gw, { quiet: true }))
    run('gofmt', ['-w', '.'], gw, { quiet: true })
    step('OpenAPI spec', run('go', ['run', './cmd/openapi-gen'], gw, { quiet: true }))
  } else {
    step('Go not found: install Go 1.26+, then run make generate', false)
  }
  if (has('bun')) {
    const web = join(dest, 'web')
    step('bun install', run('bun', ['install'], web, { quiet: true }))
    step('API types for the UI', run('bun', ['run', 'gen-api'], web, { quiet: true }))
    if (cfg.site) step('bun install (site)', run('bun', ['install'], join(dest, 'site'), { quiet: true }))
  } else {
    step('Bun not found: install it (https://bun.sh), then bun install in web/', false)
  }
  if (has('git') && !existsSync(join(dest, '.git'))) {
    const ok = run('git', ['init', '-q', '-b', 'main'], dest, { quiet: true }) && run('git', ['add', '-A'], dest, { quiet: true }) &&
      run('git', ['commit', '-q', '-m', 'Initial commit from create-duck'], dest, { quiet: true })
    step('git repository with an initial commit', ok)
  }
}

main().catch((e) => die(e.stack || e.message))

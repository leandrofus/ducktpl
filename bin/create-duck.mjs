#!/usr/bin/env node
// create-duck: scaffolds a duck-family app (Go gateway + embedded web UI,
// OpenAPI contract from code, SQLite/PostgreSQL) with the modules you pick.
//
//   bunx create-duck my-app            interactive
//   npx create-duck my-app --web preact --with auth,rbac,sse --yes
//   create-duck --check                validate the template (for its CI)
//   create-duck --install-skill        install the duck-stack agent skill for Claude Code
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FEATURES, TENANTS, WEBS, configure } from '../lib/features.mjs'
import { multiSelect, select, textInput } from '../lib/prompt.mjs'
import { check, isEmptyDir, names, removeEmptyDirs, scaffold } from '../lib/scaffold.mjs'
import { parseSchemaText, planApply } from '../lib/apply.mjs'
import { applyWithRollback, inspect } from '../lib/generate.mjs'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')
const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'duck-stack')
const tty = process.stdout.isTTY
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31), cyan = c(36)

const USAGE = `${bold('create-duck')} <name> [options]

  --manifest <file>      scaffold non-interactively from a duck.yaml or duck.json manifest
  --web react|preact     web framework (default react)
  --rls singleTenant|multitenant tenant isolation with RLS (mandatory; default singleTenant with -y)
  --with a,b,c           modules (see below); "all" for every one
  --owner <github-user>  Go module path github.com/<owner>/<name> (default: git config github.user)
  --yes, -y              no questions: defaults for what is not given
  --no-install           skip go mod tidy, code generation, bun install and git init
  --json                 machine-readable JSON output
  --check                validate the template's markers and exit
  --install-skill        install the duck-stack skill in ~/.claude/skills so AI agents
                         (Claude Code) use create-duck and ducktpl for new apps

Modules:
${FEATURES.map((f) => `  ${f.id.padEnd(7)} ${f.label} — ${dim(f.hint)}${f.requires ? dim(` (needs ${f.requires.join(', ')})`) : ''}`).join('\n')}
`

function parseArgs(argv) {
  const a = { with: null, web: null, rls: null, owner: null, yes: false, install: true, check: false, installSkill: false, name: null, help: false, manifest: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    const val = () => argv[++i] ?? die(`${x} needs a value`)
    if (x === '--manifest') a.manifest = val()
    else if (x.startsWith('--manifest=')) a.manifest = x.slice(11)
    else if (x === '--json') a.json = true
    else if (x === '--with') a.with = val()
    else if (x.startsWith('--with=')) a.with = x.slice(7)
    else if (x === '--web') a.web = val()
    else if (x.startsWith('--web=')) a.web = x.slice(6)
    else if (x === '--rls' || x === '--tenant') a.rls = val()
    else if (x.startsWith('--rls=')) a.rls = x.slice(6)
    else if (x.startsWith('--tenant=')) a.rls = x.slice(9)
    else if (x === '--owner') a.owner = val()
    else if (x.startsWith('--owner=')) a.owner = x.slice(8)
    else if (x === '--yes' || x === '-y') a.yes = true
    else if (x === '--no-install') a.install = false
    else if (x === '--check') a.check = true
    else if (x === '--install-skill') a.installSkill = true
    else if (x === '--help' || x === '-h') a.help = true
    else if (x.startsWith('-')) die(`unknown option ${x}`)
    else if (!a.name) a.name = x
    else die(`unexpected argument ${x}`)
  }
  if (a.rls) {
    const low = a.rls.toLowerCase().replace(/[-_]/g, '')
    if (low === 'singletenant' || low === 'single') a.rls = 'singleTenant'
    else if (low === 'multitenant' || low === 'multi') a.rls = 'multitenant'
    else die(`unknown --rls value "${a.rls}" (must be singleTenant or multitenant)`)
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
  if (!args.name) {
    args.name = (await textInput('Project name')).trim()
  }
  if (!args.web) {
    args.web = await select('Web framework', WEBS, { defaultId: 'react' })
  }
  if (!args.rls) {
    args.rls = await select('Tenant model (RLS)', TENANTS, { defaultId: 'singleTenant' })
  }
  if (args.with === null) {
    const chosen = await multiSelect('Modules', FEATURES)
    args.with = chosen.join(',')
  }
  if (!args.owner) {
    const def = gitConfig('github.user') || 'leandrofus'
    args.owner = (await textInput('GitHub owner for the Go module', { defaultValue: def })).trim() || def
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(USAGE)
  if (args.check) {
    const n = check(TEMPLATE)
    return console.log(green('✓ ') + `${n} template files follow the marker rules`)
  }
  if (args.installSkill) return installSkill(args.json)

  // Detect and parse manifest (duck.yaml / duck.json)
  const candidateManifest = args.manifest || (args.name && (args.name.endsWith('.yaml') || args.name.endsWith('.yml') || args.name.endsWith('.json')) && existsSync(args.name) ? args.name : null)
  let manifestRaw = null
  let manifestObj = null
  if (candidateManifest && existsSync(candidateManifest)) {
    manifestRaw = readFileSync(candidateManifest, 'utf8')
    try {
      manifestObj = parseSchemaText(manifestRaw)
    } catch (e) {
      die(`${candidateManifest}: ${e.message}`)
    }
    if (manifestObj.app) {
      if (manifestObj.app.name) args.name = manifestObj.app.name
      if (manifestObj.app.web) args.web = manifestObj.app.web
      if (manifestObj.app.rls) args.rls = manifestObj.app.rls
      if (manifestObj.app.owner) args.owner = manifestObj.app.owner
      if (manifestObj.app.modules) {
        if (Array.isArray(manifestObj.app.modules)) {
          args.with = manifestObj.app.modules.join(',')
        } else if (typeof manifestObj.app.modules === 'object') {
          args.with = Object.entries(manifestObj.app.modules).filter(([, v]) => v).map(([k]) => k).join(',')
        }
      }
    }
  }

  if (!args.yes && !manifestRaw && process.stdin.isTTY) await ask(args)
  args.web ??= 'react'
  args.owner ??= gitConfig('github.user') || 'leandrofus'
  if (!args.rls) {
    if (!args.yes && !manifestRaw) die('an RLS model is required: pass --rls singleTenant or --rls multitenant\n\n' + USAGE)
    args.rls = 'singleTenant'
  }
  if (!args.name) die('a project name is required\n\n' + USAGE)
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(args.name)) die('the name must be lowercase letters, digits and dashes, starting with a letter')
  const ids = args.with === 'all' ? FEATURES.map((f) => f.id) : (args.with || '').split(',').map((s) => s.trim()).filter(Boolean)
  let cfg
  try {
    cfg = configure(ids, args.web, args.rls)
  } catch (e) {
    die(e.message)
  }
  const dest = resolve(args.name)
  if (!isEmptyDir(dest)) die(`${dest} exists and is not empty`)
  mkdirSync(dest, { recursive: true })

  const n = names(args.name, args.owner)
  const on = FEATURES.filter((f) => cfg[f.id]).map((f) => f.id)
  if (!args.json) {
    console.log(`\n${bold('Creating')} ${n.display} in ${dest}`)
    console.log(dim(`  web: ${args.web} · rls: ${args.rls} · modules: ${on.join(', ') || 'none'} · module: ${n.module}/gateway\n`))
  }
  const files = scaffold(TEMPLATE, dest, cfg, n)
  removeEmptyDirs(dest)
  if (!args.json) console.log(green('✓ ') + `${files.length} files`)

  // Save manifest into scaffolded project
  if (manifestRaw) {
    writeFileSync(join(dest, 'duck.yaml'), manifestRaw, 'utf8')
  }

  // Apply declarative schema resources if defined
  let appliedResources = []
  if (manifestObj && manifestObj.resources && Object.keys(manifestObj.resources).length > 0) {
    try {
      const p = inspect(dest)
      const planned = planApply(p, manifestRaw, { generate: false })
      applyWithRollback(dest, planned.files)
      appliedResources = planned.resources
    } catch (e) {
      if (!args.json) console.error(yellow('! Failed applying initial schema resources: ' + e.message))
    }
  }

  if (args.install) postInstall(dest, cfg, args.json)

  if (args.json) {
    console.log(JSON.stringify({
      status: 'ok',
      name: n.lower,
      dest,
      web: args.web,
      rls: args.rls,
      modules: on,
      resources: appliedResources,
      next: [
        `cd ${args.name}`,
        'npx ducktpl info --json',
        'npx ducktpl add <resource> <field:type[!]>... --json',
        'npx ducktpl apply schema.yaml --json',
        'make test',
      ],
    }, null, 2))
    return
  }

  console.log(`
${green('Done.')} Next:

  cd ${args.name}
  make dev        ${dim('# gateway on :8080 + Vite with hot reload on :5173')}
  make build      ${dim('# one binary with the UI inside: dist/bin/' + n.lower)}
  make help       ${dim('# everything else')}

  ${bold('npx ducktpl add')} tasks title:string! done:bool   ${dim('# a resource through every layer')}
  ${bold('npx ducktpl --help')}                             ${dim('# columns, DTOs, actions, events, modules')}

${dim('AI agents: create-duck --install-skill teaches Claude Code to use these. See CLAUDE.md.')}
`)
}

// Copies the duck-stack skill to ~/.claude/skills, replacing an older copy.
function installSkill(json) {
  const dest = join(homedir(), '.claude', 'skills', 'duck-stack')
  let existed = false
  try {
    lstatSync(dest)
    existed = true
    rmSync(dest, { recursive: true, force: true })
  } catch {}
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(SKILL, dest, { recursive: true })
  if (json) return console.log(JSON.stringify({ status: 'ok', action: 'install-skill', dest, replaced: existed }, null, 2))
  console.log(green('✓ ') + `duck-stack skill ${existed ? 'updated' : 'installed'} in ${dest}`)
  console.log(dim('  Claude Code now starts new apps with create-duck and extends them with ducktpl.'))
}

function postInstall(dest, cfg, json) {
  // --json keeps stdout a single JSON document
  const step = (label, ok) => json || console.log((ok ? green('✓ ') : yellow('! ')) + label + (ok ? '' : yellow(' (failed; run it yourself)')))
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

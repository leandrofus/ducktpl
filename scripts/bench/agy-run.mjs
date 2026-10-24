#!/usr/bin/env node
// Runs one brief through `agy` as a cold user of the duck-stack skill and measures it.
//
//   node scripts/bench/agy-run.mjs <name> "<brief>" [--root /tmp/duck-bench] [--timeout 25] [--explore 8]
//
// The agent works in <root>/<name>, with create-duck / ducktpl installed from a packed copy of
// this repo (not the repo itself) and the skill copied to .agents/skills. Its stream-json is read
// as it happens: the run is cut at the first path outside that directory or any look at the
// tools' own source, and when it explores more than --explore steps before running create-duck.
// Afterwards `make test` is run here, not by the agent, and everything goes to <root>/<name>.result.json.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAFE = ['/usr/', '/bin/', '/dev/null', '/dev/stdout', '/dev/stderr', join(homedir(), 'go') + sep]
const SOURCE = /node_modules\/create-duck|duck-template|\/lib\/(generate|moddb|modules|apply)\.mjs/

/** Why this tool call is not allowed, or null. `params` is the tool's parameters object. */
export function violation(dir, tool, params) {
  const strings = []
  const walk = (v) => (typeof v === 'string' ? strings.push(v) : v && typeof v === 'object' && Object.values(v).forEach(walk))
  walk(params)
  for (const s of strings) {
    if (SOURCE.test(s)) return `looks at the tools' own source: ${s.slice(0, 120)}`
    const text = s.replace(/file:\/\//g, '')
    for (const m of text.matchAll(/(?:^|[\s"'=:(])((?:~|\.{1,2}(?=\/|$)|\/)[^\s"';|&)<>]*)/g)) {
      const tok = m[1]
      if (tok === '/' || tok === '.' || tok.startsWith('./')) continue
      const abs = tok.startsWith('~') ? join(homedir(), tok.slice(1)) : resolve(dir, tok)
      if (abs === dir || abs.startsWith(dir + sep) || SAFE.some((p) => abs.startsWith(p))) continue
      return `${tool} reaches outside the work directory: ${tok}`
    }
    if (/\$HOME|\$\{HOME\}/.test(s)) return `${tool} uses $HOME`
  }
  return null
}

/** A step that only looks: reading, listing, searching, git status, --help. Writing the manifest is not. */
export function exploring(tool, cmd) {
  if (cmd) return /^\s*(ls|cat|head|tail|find|grep|rg|which|pwd|tree|git\s+(status|log|remote|diff)|file|stat|wc)\b|--help|\s-h\b/.test(cmd) && !/[>]\s*\S/.test(cmd)
  return /read|view|list|grep|find|search/i.test(tool ?? '')
}

function main() {
  const argv = process.argv.slice(2)
  const opt = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def)
  const [name, brief] = argv
  if (!name || !brief) {
    console.error('usage: agy-run.mjs <name> "<brief>" [--root DIR] [--timeout MIN] [--explore N]')
    process.exit(2)
  }
  const root = resolve(opt('--root', '/tmp/duck-bench'))
  const timeoutMin = Number(opt('--timeout', 25))
  const maxExplore = Number(opt('--explore', 12))
  const dir = join(root, name)

  // a clean directory with the tools installed from a pack of this repo
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"bench","private":true}\n')
  const pack = spawnSync('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: REPO, encoding: 'utf8' })
  if (pack.status !== 0) throw new Error(`npm pack: ${pack.stderr}`)
  const tgz = join(dir, pack.stdout.trim().split('\n').pop())
  const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent', tgz], { cwd: dir, encoding: 'utf8' })
  if (inst.status !== 0) throw new Error(`npm install: ${inst.stderr}`)
  rmSync(tgz)
  mkdirSync(join(dir, '.agents', 'skills'), { recursive: true })
  cpSync(join(REPO, 'skills', 'duck-stack'), join(dir, '.agents', 'skills', 'duck-stack'), { recursive: true })
  spawnSync('git', ['init', '-q', '.'], { cwd: dir })

  const prompt = `/duck-stack ${brief}

Sigue los pasos del skill tal cual, sin explorar: no leas el código de create-duck ni de ducktpl, no salgas de este directorio y no busques otros proyectos. Si un comando falla, corrige con lo que dicen el skill, su reference.md o el --help del comando. Al terminar deja \`make test\` en verde y resume en pocas líneas qué comandos usaste.`

  const env = { ...process.env, PATH: [join(dir, 'node_modules', '.bin'), join(homedir(), 'go', 'bin'), '/usr/local/go/bin', process.env.PATH].join(':') }
  const events = []
  const state = { steps: 0, commands: [], exploredBeforeCreate: 0, created: false, killed: null, tokens: 0, response: '' }
  const started = Date.now()
  const child = spawn('agy', ['-p', prompt, '--mode', 'accept-edits', '--output-format', 'stream-json', '--print-timeout', `${timeoutMin}m`], { cwd: dir, env })
  const stop = (why) => {
    if (state.killed) return
    state.killed = why
    console.log(`\n✗ cut: ${why}`)
    child.kill('SIGTERM')
  }
  const timer = setTimeout(() => stop(`timeout after ${timeoutMin} min`), (timeoutMin + 1) * 60_000)

  let buf = ''
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      events.push(line)
      let e
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      const su = e.step_update
      if (e.event === 'result') {
        state.tokens = e.result?.usage?.total_tokens ?? 0
        state.response = e.result?.response ?? ''
      }
      if (su?.step_type === 'tool' && su.state === 'ACTIVE') {
        state.steps++
        const params = su.tool_info?.parameters ?? {}
        const cmd = params.CommandLine
        const label = cmd ?? `${su.tool_name} ${JSON.stringify(params).slice(0, 100)}`
        console.log(`  ${String(state.steps).padStart(3)} ${label.slice(0, 150)}`)
        if (cmd) state.commands.push(cmd)
        if (cmd && /create-duck/.test(cmd) && !/--help|-h\b/.test(cmd)) state.created = true
        else if (!state.created && exploring(su.tool_name, cmd)) state.exploredBeforeCreate++
        const why = violation(dir, su.tool_name, params)
        if (why) stop(why)
        else if (!state.created && state.exploredBeforeCreate > maxExplore) stop(`explored ${state.exploredBeforeCreate} steps before running create-duck`)
      }
    }
  })
  child.stderr.on('data', () => {})
  child.on('close', (code) => {
    clearTimeout(timer)
    writeFileSync(join(root, `${name}.events.jsonl`), events.join('\n') + '\n')
    const apps = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'gateway', 'go.mod'))).map((d) => d.name) : []
    const result = {
      name, brief,
      status: state.killed ? 'cut' : code === 0 ? 'finished' : 'agent-error',
      reason: state.killed ?? undefined,
      seconds: Math.round((Date.now() - started) / 1000),
      tokens: state.tokens,
      steps: state.steps,
      exploredBeforeCreate: state.exploredBeforeCreate,
      app: apps[0] ?? null,
      agentSummary: state.response.slice(0, 1500),
    }
    if (apps[0]) {
      const app = join(dir, apps[0])
      const logFile = join(app, '.ducktpl', 'log.jsonl')
      const runs = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
      result.ducktplRuns = runs.length
      result.ducktplErrors = runs.filter((r) => r.status === 'error').map((r) => ({ argv: r.argv.join(' ').slice(0, 120), error: r.error?.message?.slice(0, 160) }))
      const t = spawnSync('make', ['test'], { cwd: app, env, encoding: 'utf8', timeout: 600_000 })
      result.makeTest = { pass: t.status === 0, tail: t.status === 0 ? undefined : `${t.stdout}\n${t.stderr}`.trim().split('\n').slice(-12).join('\n') }
    }
    writeFileSync(join(root, `${name}.result.json`), JSON.stringify(result, null, 2) + '\n')
    console.log('\n' + JSON.stringify({ ...result, agentSummary: undefined }, null, 2))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

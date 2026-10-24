// runlog: one JSON line per ducktpl run (what was asked, what came out, what failed), for
// looking back at later: `ducktpl log`, or jq over .ducktpl/log.jsonl.
//
//   DUCKTPL_LOG=0         no log (also --no-log)
//   DUCKTPL_LOG_FILE=…    write there instead
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const MAX_TEXT = 100_000 // per stream; the head is kept
const MAX_FILE = 5_000_000 // then log.jsonl moves to log.jsonl.1

const ANSI = /\x1b\[[0-9;]*m/g
const SECRET = /pass|token|secret|key/i

/** The arguments with the value of anything that looks like a secret hidden. */
export function redact(argv) {
  return argv.map((a, i) => {
    const eq = a.indexOf('=')
    if (a.startsWith('-') && eq > 0 && SECRET.test(a.slice(0, eq))) return `${a.slice(0, eq)}=***`
    if (i > 0 && argv[i - 1].startsWith('-') && !argv[i - 1].includes('=') && SECRET.test(argv[i - 1])) return '***'
    return a
  })
}

/** create / update / delete lines of the plain output: what the run did to the project. */
export function changesIn(text) {
  const out = []
  for (const m of text.matchAll(/^\s*(create\/update|create|update|delete|remove)\s+(\S+)/gm)) out.push({ op: m[1], path: m[2] })
  return out
}

export function logFile(root) {
  if (process.env.DUCKTPL_LOG_FILE) return process.env.DUCKTPL_LOG_FILE
  if (root) return join(root, '.ducktpl', 'log.jsonl')
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'ducktpl', 'log.jsonl')
}

const off = (argv) => /^(0|off|false|no)$/i.test(process.env.DUCKTPL_LOG ?? '') || argv.includes('--no-log')

/**
 * Starts recording this process. Call setRoot(root) once the project is known; the record
 * is written when the process exits, whichever way (return, die(), an uncaught error).
 */
export function startRunLog({ argv, version }) {
  const started = Date.now()
  const command = argv.find((a) => !a.startsWith('-')) ?? ''
  const state = { root: null, error: null }
  const streams = { stdout: '', stderr: '' }
  for (const name of ['stdout', 'stderr']) {
    const write = process[name].write.bind(process[name])
    process[name].write = (chunk, ...rest) => {
      if (streams[name].length < MAX_TEXT) streams[name] += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return write(chunk, ...rest)
    }
  }

  process.on('uncaughtException', (e) => {
    state.error = { message: e.message, code: 'ERR_UNCAUGHT', stack: e.stack }
    process.stderr.write(`${e.stack}\n`)
    process.exit(1)
  })

  process.on('exit', (exitCode) => {
    if (off(argv) || command === 'log' || !argv.length || argv.includes('-h') || argv.includes('--help')) return
    const clean = (s) => s.replace(ANSI, '').slice(0, MAX_TEXT)
    const stdout = clean(streams.stdout)
    const stderr = clean(streams.stderr)
    const json = (text) => {
      try {
        return JSON.parse(text)
      } catch {
        return undefined
      }
    }
    const failure = json(stderr.trim().split('\n').at(-1) ?? '')
    // some commands report a failure on stdout (ducktpl check lists its issues there)
    const reported = json(stdout.trim())
    const issues = Array.isArray(reported?.issues) ? reported.issues : []
    const error = state.error ?? (exitCode ? {
      message: failure?.error ?? /✗\s*(.+)/.exec(stderr)?.[1] ?? stderr.trim().split('\n')[0]
        ?? reported?.error ?? (issues.length ? issues.map((i) => i.message).join('; ').slice(0, 400) : `exit ${exitCode}`),
      ...(issues[0]?.code && { code: issues[0].code }),
      ...(failure?.code && { code: failure.code }),
      ...(failure?.step && { step: failure.step }),
      ...(failure?.detail && { detail: failure.detail }),
    } : undefined)
    const record = {
      v: 1,
      ts: new Date(started).toISOString(),
      id: randomBytes(4).toString('hex'),
      ducktpl: version,
      node: process.version,
      cwd: process.cwd(),
      root: state.root,
      command,
      argv: redact(argv),
      exitCode,
      status: exitCode ? 'error' : 'ok',
      durationMs: Date.now() - started,
      result: json(stdout.trim()),
      changes: changesIn(stdout),
      stdout: json(stdout.trim()) === undefined ? stdout : undefined,
      stderr: stderr || undefined,
      error,
    }
    try {
      const file = logFile(state.root)
      mkdirSync(dirname(file), { recursive: true })
      if (existsSync(file) && statSync(file).size > MAX_FILE) renameSync(file, `${file}.1`)
      appendFileSync(file, JSON.stringify(record) + '\n')
    } catch {
      // a log that cannot be written must never change what the command did
    }
  })

  return { setRoot: (root) => (state.root = root) }
}

/** The last runs, newest last. */
export function readLog(root, { last = 20, errors = false } = {}) {
  const file = logFile(root)
  if (!existsSync(file)) return []
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)]
    } catch {
      return []
    }
  })
  return (errors ? rows.filter((r) => r.status === 'error') : rows).slice(-last)
}

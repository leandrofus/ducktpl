import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redact, changesIn } from './runlog.mjs'
import { setupMockProject } from './testutil.mjs'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ducktpl.mjs')
const run = (cwd, args, env = {}) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, DUCKTPL_LOG_FILE: '', ...env } })
const lines = (dir) => readFileSync(join(dir, '.ducktpl', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('redact hides the value of anything that looks like a secret', () => {
  assert.deepEqual(redact(['add', 'x', '--admin-password=hunter2', '--api-key', 'abc', '--json']), ['add', 'x', '--admin-password=***', '--api-key', '***', '--json'])
})

test('changesIn reads what a run did from its plain output', () => {
  assert.deepEqual(changesIn('  create web/src/a.ts\n  update gateway/x.go\n  create/update a/b.sql\nDone'), [
    { op: 'create', path: 'web/src/a.ts' },
    { op: 'update', path: 'gateway/x.go' },
    { op: 'create/update', path: 'a/b.sql' },
  ])
})

test('every run is one line in .ducktpl/log.jsonl: input, output and error', () => {
  const dir = setupMockProject()
  try {
    const ok = run(dir, ['info', '--json'])
    assert.equal(ok.status, 0, ok.stderr)
    const bad = run(dir, ['add', 'Bad Name', 'x:string', '--json'])
    assert.notEqual(bad.status, 0)
    run(dir, ['info', '--no-log'])

    const [a, b, ...more] = lines(dir)
    assert.equal(more.length, 0, '--no-log writes nothing')
    assert.equal(a.command, 'info')
    assert.equal(a.status, 'ok')
    assert.equal(a.result.action, 'info', 'the JSON output is kept parsed')
    assert.equal(a.root, dir)
    assert.ok(a.durationMs >= 0 && a.id.length === 8 && a.ts)
    assert.deepEqual(a.argv, ['info', '--json'])
    assert.equal(b.status, 'error')
    assert.equal(b.exitCode, 1)
    assert.ok(b.error.message.length > 0, JSON.stringify(b.error))
    assert.deepEqual(b.argv, ['add', 'Bad Name', 'x:string', '--json'])

    const shown = run(dir, ['log', '--errors', '--json'])
    const out = JSON.parse(shown.stdout)
    assert.equal(out.runs.length, 1)
    assert.equal(out.runs[0].id, b.id)
    assert.equal(lines(dir).length, 2, '`ducktpl log` does not log itself')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('DUCKTPL_LOG=0 turns the log off', () => {
  const dir = setupMockProject()
  try {
    run(dir, ['info', '--json'], { DUCKTPL_LOG: '0' })
    assert.ok(!existsSync(join(dir, '.ducktpl')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

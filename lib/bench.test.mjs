import test from 'node:test'
import assert from 'node:assert/strict'
import { exploring, violation } from '../scripts/bench/agy-run.mjs'

const D = '/tmp/duck-bench/x'

test('the bench cuts a run that leaves its directory or reads the tools', () => {
  for (const [tool, p] of [
    ['run_command', { CommandLine: 'ls ..' }],
    ['run_command', { CommandLine: 'cat ../../cj.txt' }],
    ['run_command', { CommandLine: 'grep -rn calendar /home/rodrigo/duck-template/lib' }],
    ['run_command', { CommandLine: 'cat node_modules/create-duck/lib/generate.mjs' }],
    ['run_command', { CommandLine: 'ls ~/.claude' }],
    ['list_dir', { DirectoryPath: '/home/rodrigo' }],
    ['view_file', { AbsolutePath: '/tmp/duck-bench/other/x.txt' }],
    ['run_command', { CommandLine: 'cat $HOME/.ssh/id_rsa' }],
  ]) assert.ok(violation(D, tool, p), `${tool} ${JSON.stringify(p)} should be cut`)
})

test('the bench lets normal work through', () => {
  for (const [tool, p] of [
    ['run_command', { CommandLine: 'npx create-duck --manifest duck.yaml --yes --json' }],
    ['run_command', { CommandLine: 'cd turnero && npx ducktpl check --json && make test' }],
    ['run_command', { CommandLine: 'ls -la ./turnero/gateway' }],
    ['run_command', { CommandLine: 'cat .agents/skills/duck-stack/reference.md' }],
    ['write_to_file', { TargetFile: '/tmp/duck-bench/x/duck.yaml', CodeContent: 'app:\n  name: x\n' }],
    ['run_command', { CommandLine: 'go vet ./... 2>/dev/null && /usr/local/go/bin/go test ./...' }],
    ['view_file', { AbsolutePath: '/tmp/duck-bench/x/turnero/Makefile' }],
  ]) assert.equal(violation(D, tool, p), null, `${tool} ${JSON.stringify(p)} should pass`)
})

test('only steps that look count as exploring: writing the manifest does not', () => {
  assert.ok(exploring('run_command', 'ls -la'))
  assert.ok(exploring('run_command', 'npx create-duck --help'))
  assert.ok(exploring('read_file', undefined))
  assert.ok(exploring('grep_search', undefined))
  assert.ok(!exploring('write_file', undefined))
  assert.ok(!exploring('run_command', 'npx create-duck --manifest duck.yaml --yes --json'))
  assert.ok(!exploring('run_command', 'echo x > duck.yaml'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURES, WEBS } from './features.mjs'
import { multiSelect, select } from './prompt.mjs'

test('multiSelect non-TTY returns selectedIds', async () => {
  // When process.stdin.isTTY is false or non-interactive
  const res = await multiSelect('Modules', FEATURES, { selectedIds: ['auth', 'sse'] })
  assert.deepEqual(res, ['auth', 'sse'])
})

test('select non-TTY returns defaultId', async () => {
  const res = await select('Web framework', WEBS, { defaultId: 'preact' })
  assert.equal(res, 'preact')
})

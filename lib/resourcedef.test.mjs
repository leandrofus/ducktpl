import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFields, plan } from './generate.mjs'
import { planModdb } from './moddb.mjs'
import { addField, changeField, removeField, renameField } from './resourcedef.mjs'
import { setupMockProject } from './testutil.mjs'

const def = (dir) => {
  const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
  return plan(p, 'slots', parseFields(['starts_at:time!', 'note_text:text', 'status:string:enum(open,done)']), { ui: 'none' })
    .files.find((f) => f.path === 'web/src/resources/slots.ts').content
}

test('addField, removeField, changeField and renameField edit one entry of fields', () => {
  const dir = setupMockProject()
  try {
    const t0 = def(dir)
    const [extra] = parseFields(['room:string!'])
    const t1 = addField(t0, extra)
    assert.ok(t1.includes("{ name: 'room', label: 'Room', type: 'string', required: true },"))
    assert.equal(addField(t1, extra), null, 'twice')
    assert.equal(removeField(t1, 'room'), t0)
    const t2 = renameField(t0, 'note_text', 'memo')
    assert.ok(t2.includes("name: 'memo', label: 'Memo'") && !t2.includes('note_text'))
    const [num] = parseFields(['note_text:int'])
    assert.ok(changeField(t0, num).includes("name: 'note_text', label: 'Note text', type: 'int' }"))
    assert.equal(removeField(t0, 'nope'), null)
    assert.equal(addField('export const x = 1\n', extra), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('moddb edits web/src/resources/<table>.ts instead of asking for a page edit', () => {
  const dir = setupMockProject()
  try {
    mkdirSync(join(dir, 'web/src/resources'), { recursive: true })
    const text = def(dir).replace("name: 'starts_at'", "name: 'priority'")
    writeFileSync(join(dir, 'web/src/resources/items.ts'), text)
    const p = { root: dir }
    const planned = planModdb(p, 'addColumn', ['items', 'rank:int'])
    const edited = planned.files.find((f) => f.path === 'web/src/resources/items.ts')
    assert.ok(edited.content.includes("name: 'rank', label: 'Rank', type: 'int'"))
    assert.ok(!planned.notes.some((n) => n.startsWith('Frontend:')))
    const removed = planModdb(p, 'removeColumn', ['items', 'priority'])
    assert.ok(!removed.files.find((f) => f.path === 'web/src/resources/items.ts').content.includes("'priority'"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

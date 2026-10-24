import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { setupMockProject } from './testutil.mjs'
import { parseFields, parseSingleField, plan } from './generate.mjs'
import { addFieldToHandler, addKeyToTest, removeFieldFromHandler, removeKeyFromTest } from './handleredit.mjs'
import { updateHandler } from './moddb.mjs'

// The handler and test `add` writes for a resource, in a mock project.
function generated(table, specs) {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const files = plan(p, table, parseFields(specs)).files
    return { handler: files.find((f) => f.path.endsWith(`server/${table}.go`)).content, test: files.find((f) => f.path.endsWith(`server/${table}_test.go`)).content }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const norm = (s) => s.replace(/[ \t]+/g, ' ').replace(/ ,/g, ',')

test('a column added to a handler lands in every struct, literal and the PATCH', () => {
  const { handler } = generated('posts', ['title:string!', 'body:text'])
  const out = addFieldToHandler(handler, parseSingleField('reading_time:int'))
  assert.equal((out.match(/ReadingTime\s+int64\s+`json:"reading_time"`/g) || []).length, 2) // DTO and create request
  assert.match(out, /ReadingTime\s+opt\[int64\]\s+`json:"reading_time"`/)
  assert.match(out, /ReadingTime: x\.ReadingTime, CreatedAt:/)
  assert.match(out, /v := db\.Post\{[^\n]*ReadingTime: req\.ReadingTime\}/)
  assert.match(out, /db\.CreatePostParams\{[^\n]*ReadingTime: v\.ReadingTime/)
  assert.match(out, /db\.UpdatePostParams\{[^\n]*ReadingTime: v\.ReadingTime/)
  // a literal that omits it would compile and reset the column on every PATCH
  assert.match(out, /if req\.ReadingTime\.Set \{\n\s*v\.ReadingTime = req\.ReadingTime\.V\n\s*\}/)
  assert.equal((out.match(/\/\/   reading_time: \{ type: integer, format: int64 \}/g) || []).length, 3) // DTO, create, update
  assert.doesNotMatch(out, /PaginatedPosts[\s\S]{0,400}reading_time/)
})

test('an optional reference is nullable all the way: pointer in the API, sql.Null in the db', () => {
  const { handler } = generated('posts', ['title:string!'])
  const x = parseSingleField('reviewer:ref:posts')
  x.ref = { Singular: 'Post', one_label: 'post' }
  const out = addFieldToHandler(handler, x)
  assert.match(out, /ReviewerID\s+\*string\s+`json:"reviewer_id"`/)
  assert.match(out, /ReviewerID: strPtr\(x\.ReviewerID\)/)
  assert.match(out, /ReviewerID: nullStr\(req\.ReviewerID\)/)
  assert.match(out, /sql\.NullString\{String: req\.ReviewerID\.V/)
  assert.ok(out.includes('"database/sql"'))
  assert.match(out, /if v\.ReviewerID\.Valid \{/) // the reference is checked
})

test('enum and required modifiers become validation in checkX', () => {
  const { handler } = generated('posts', ['title:string!'])
  const out = addFieldToHandler(handler, parseSingleField('visibility:string!:enum(public,private)'))
  assert.match(out, /visibility must be one of: public, private/)
  assert.match(out, /\/\/ required: \[[^\]]*visibility\]/) // create request
})

test('add then remove gives back the handler `add` wrote', () => {
  for (const spec of ['reading_time:int', 'reviewer:ref:posts', 'visibility:string!:enum(public,private)', 'extra:json', 'at:time']) {
    const { handler } = generated('posts', ['title:string!', 'body:text'])
    const x = parseSingleField(spec)
    if (x.type === 'ref') x.ref = { Singular: 'Post', one_label: 'post' }
    const there = addFieldToHandler(handler, x)
    assert.notEqual(norm(there), norm(handler), spec)
    assert.equal(norm(removeFieldFromHandler(there, x.name, x.Go)), norm(handler), `round trip ${spec}`)
  }
})

test('retyping a column replaces it everywhere with the new type', () => {
  const { handler } = generated('posts', ['title:string!', 'reading_time:int'])
  const x = parseSingleField('reading_time:float')
  const out = updateHandler(handler, 'posts', 'changeType', { name: x.name, field: x })
  assert.match(out, /ReadingTime\s+float64\s+`json:"reading_time"`/)
  assert.match(out, /ReadingTime\s+opt\[float64\]/)
  assert.doesNotMatch(out, /int64\s+`json:"reading_time"`/)
  assert.match(out, /reading_time: \{ type: number, format: double \}/)
  assert.equal((out.match(/if req\.ReadingTime\.Set/g) || []).length, 1)
})

test('payloads in the resource test follow the column: added, renamed and removed', () => {
  const { test: t } = generated('posts', ['title:string!', 'body:text'])
  const added = addKeyToTest(t, '/posts', 'subtitle', '"example"')
  assert.match(added, /"POST", "\/posts", map\[string\]any\{"subtitle": "example", "title"/)
  assert.match(added, /\{"nope": 1\}/) // the deliberately invalid payload stays as it was
  assert.equal(removeKeyFromTest(added, 'subtitle'), t)
  assert.equal(removeKeyFromTest('x(map[string]any{"a": fmt.Sprintf("s_%d", c.Add(1)), "b": 2})', 'a'), 'x(map[string]any{"b": 2})')
})

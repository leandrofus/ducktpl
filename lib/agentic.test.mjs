import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planModdb } from './moddb.mjs'
import { applyWithRollback, plan, resourceNames, parseFields } from './generate.mjs'
import { planApply, parseSchemaText } from './apply.mjs'
import { planRemove } from './remove.mjs'
import { planAction } from './action.mjs'
import { planObserver } from './observer.mjs'
import { checkProject } from './doctor.mjs'
import { listModules, activateModule } from './modules.mjs'
import { planSeed } from './seed.mjs'

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')

import { setupMockProject } from './testutil.mjs'

test('planModdb changeType preserves SQLite indexes and wraps foreign keys', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planModdb(p, 'changeType', ['items', 'priority:int!'], { force: true })

    const sqliteMig = planned.files.find((f) => f.path.includes('sqlite') && f.path.includes('change_priority_type'))
    assert.ok(sqliteMig)
    assert.ok(sqliteMig.content.includes('PRAGMA foreign_keys = OFF;'))
    assert.ok(sqliteMig.content.includes('PRAGMA foreign_keys = ON;'))
    assert.ok(sqliteMig.content.includes('CREATE INDEX items_priority_idx ON items (priority);'))

    const pgMig = planned.files.find((f) => f.path.includes('postgres') && f.path.includes('change_priority_type'))
    assert.ok(pgMig)
    // PostgreSQL takes the type, the default and NOT NULL as separate statements
    assert.ok(pgMig.content.includes("ALTER COLUMN priority TYPE BIGINT USING COALESCE(NULLIF(priority::text, '')::BIGINT, 0);"))
    assert.ok(pgMig.content.includes('ALTER COLUMN priority SET DEFAULT 0;'))
    assert.ok(pgMig.content.includes('ALTER COLUMN priority SET NOT NULL;'))
    assert.ok(!/TYPE [^;]*NOT NULL/.test(pgMig.content))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planModdb detects existing frontend pages and provides actionable notes', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planModdb(p, 'addColumn', ['items', 'status:string!'])
    assert.equal(planned.frontendPage, 'web/src/pages/Items.tsx')
    assert.ok(planned.notes.some((n) => n.includes('web/src/pages/Items.tsx')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyWithRollback restores modified files and deletes created files on rollback', () => {
  const dir = setupMockProject()
  try {
    const existingFile = 'web/src/pages/Items.tsx'
    const newFile = 'web/src/pages/NewComponent.tsx'
    const originalContent = readFileSync(join(dir, existingFile), 'utf8')

    const files = [
      { path: existingFile, content: '// MODIFIED CONTENT', created: false },
      { path: newFile, content: '// BRAND NEW FILE', created: true },
    ]

    const handle = applyWithRollback(dir, files)

    assert.equal(readFileSync(join(dir, existingFile), 'utf8'), '// MODIFIED CONTENT')
    assert.equal(existsSync(join(dir, newFile)), true)

    // Trigger rollback
    handle.rollback()

    assert.equal(readFileSync(join(dir, existingFile), 'utf8'), originalContent)
    assert.equal(existsSync(join(dir, newFile)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('plan auto-scaffolds missing seed helpers for ref tables instead of throwing', () => {
  const dir = setupMockProject()
  try {
    const p = {
      root: dir,
      auth: true,
      rbac: false,
      live: false,
      multitenant: false,
    }

    const n = resourceNames('tasks', 'task')
    const fields = parseFields(['title:string!', 'parent:ref:items!'])

    // Prior to our improvement, this threw: tests need a seedItem helper
    const planned = plan(p, n, fields, { cmd: 'add' })

    const testPatch = planned.files.find((f) => f.path === 'gateway/internal/server/server_test.go')
    assert.ok(testPatch)
    assert.ok(testPatch.content.includes('func seedItem(c *client) string'))
    assert.ok(planned.notes.some((note) => note.includes('auto-scaffolded test helper "seedItem"')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseFields and plan support :unique, :index, and :default(...) modifiers', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const n = resourceNames('users', 'user')
    const fields = parseFields(['email:string!:unique', 'slug:string:index', 'status:string!:default(pending)'])

    const planned = plan(p, n, fields, { cmd: 'add' })
    const migSqlite = planned.files.find((f) => f.path.includes('sqlite') && f.path.includes('users.sql'))
    assert.ok(migSqlite)
    assert.ok(migSqlite.content.includes('email      TEXT NOT NULL DEFAULT \'\' UNIQUE'))
    assert.ok(migSqlite.content.includes('status     TEXT NOT NULL DEFAULT \'pending\''))
    assert.ok(migSqlite.content.includes('CREATE INDEX users_slug ON users (slug);'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planApply correctly sorts and plans multi-resource schemas', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const schemaYaml = `
resources:
  authors:
    fields:
      - name:string!
  articles:
    fields:
      - title:string!
      - author:ref:authors!
`
    const planned = planApply(p, schemaYaml)
    assert.equal(planned.resources.length, 2)
    assert.equal(planned.resources[0].resource, 'authors')
    assert.equal(planned.resources[1].resource, 'articles')
    assert.ok(planned.files.some((f) => f.path.includes('authors.sql')))
    assert.ok(planned.files.some((f) => f.path.includes('articles.sql')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planAction generates action endpoint, route and test', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const planned = planAction(p, 'items', 'archive')

    assert.equal(planned.route, 'POST /api/v1/items/{id}/archive')
    const handlerPatch = planned.files.find((f) => f.path.includes('items.go'))
    assert.ok(handlerPatch)
    assert.ok(handlerPatch.content.includes('archiveItem'))
    assert.ok(handlerPatch.content.includes('openapi:operation'))
    assert.ok(handlerPatch.content.includes('Archive a item'))

    const serverPatch = planned.files.find((f) => f.path.includes('server.go'))
    assert.ok(serverPatch)
    assert.ok(serverPatch.content.includes('POST /api/v1/items/{id}/archive'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planObserver generates observer handler, registration and test', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, module: 'github.com/test/app/gateway', auth: false, rbac: false, live: false, multitenant: false }
    const planned = planObserver(p, 'posts.like', 'invalidateCache', { preset: 'cache' })

    assert.equal(planned.action, 'on')
    assert.equal(planned.preset, 'cache')
    assert.equal(planned.method, 'onInvalidateCache')

    const obsPatch = planned.files.find((f) => f.path.includes('observers.go'))
    assert.ok(obsPatch)
    assert.ok(obsPatch.content.includes('s.Events.On("posts.like", s.onInvalidateCache)'))
    assert.ok(obsPatch.content.includes('func (s *Server) onInvalidateCache(ev events.Event)'))
    assert.ok(obsPatch.content.includes('[cache]'))

    const serverPatch = planned.files.find((f) => f.path.includes('server.go'))
    assert.ok(serverPatch)
    assert.ok(serverPatch.content.includes('s.registerObservers()'))

    const testPatch = planned.files.find((f) => f.path.includes('observers_test.go'))
    assert.ok(testPatch)
    assert.ok(testPatch.content.includes('TestObserverInvalidateCache'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planRemove plans clean deletion of resource and anchor cleanups', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const planned = planRemove(p, 'items')

    assert.ok(planned.filesToDelete.some((f) => f.includes('00001_items.sql')))
    assert.ok(planned.filesToDelete.some((f) => f.includes('queries/items.sql')))
    assert.ok(planned.filesToDelete.some((f) => f.includes('items.go')))
    assert.ok(planned.filesToDelete.some((f) => f.includes('Items.tsx')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rollback also removes the Go sqlc generated from a query it created', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rollback-test-'))
  try {
    mkdirSync(join(dir, 'gateway/internal/store/queries'), { recursive: true })
    mkdirSync(join(dir, 'gateway/internal/store/db'), { recursive: true })
    const res = applyWithRollback(dir, [{ path: 'gateway/internal/store/queries/pages2.sql', content: '-- q' }])
    writeFileSync(join(dir, 'gateway/internal/store/db/pages2.sql.go'), 'package db') // what make generate would add
    res.rollback()
    assert.equal(existsSync(join(dir, 'gateway/internal/store/queries/pages2.sql')), false)
    assert.equal(existsSync(join(dir, 'gateway/internal/store/db/pages2.sql.go')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resource names: singular in a schema, and names that shadow api.ts types', () => {
  assert.equal(parseSchemaText('resources:\n  media:\n    singular: medium\n    fields:\n      - url:string!\n').resources.media.singular, 'medium')
  assert.throws(() => resourceNames('media'), /singular: <word>/)
  assert.equal(resourceNames('media', 'medium').Singular, 'Medium')
  assert.throws(() => resourceNames('pages'), /type named Page/)
  assert.equal(resourceNames('static_pages').Singular, 'StaticPage')
})

test('json fields are strings end to end: validated, defaulted, and one OpenAPI type', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const planned = plan(p, 'plugins', parseFields(['slug:string!', 'settings:json']))
    const handler = planned.files.find((f) => f.path.endsWith('server/plugins.go')).content
    assert.ok(handler.includes('"encoding/json"'), 'import')
    assert.ok(handler.includes('json.Valid([]byte(v.Settings))'), 'valid')
    assert.ok(handler.includes('v.Settings = "{}"'), 'default') // empty is the column default, not invalid JSON
    assert.ok(/settings: \{ type: string \}/.test(handler), 'schema') // the DTO field is a Go string
    assert.ok(!handler.includes('settings: { type: object }'), 'object')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('observer files import what their preset uses: no context for log, time for cache', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, module: 'github.com/test/app/gateway', auth: false, rbac: false, live: false, multitenant: false }
    const importsOf = (preset) => {
      const planned = planObserver(p, 'posts.like', 'doIt', { preset })
      const code = planned.files.find((f) => f.path.includes('observers.go')).content
      return /import \(\n([\s\S]*?)\n\)/.exec(code)[1]
    }
    assert.doesNotMatch(importsOf('log'), /"context"|"time"/) // neither is used: Go refuses unused imports
    assert.match(importsOf('cache'), /"time"/) // time.Now() needs it
    assert.match(importsOf('webhook'), /"context"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planRemove also deletes the Go sqlc generated for the resource', () => {
  const dir = setupMockProject()
  try {
    mkdirSync(join(dir, 'gateway/internal/store/db'), { recursive: true })
    writeFileSync(join(dir, 'gateway/internal/store/db/items.sql.go'), 'package db')
    const planned = planRemove({ root: dir, auth: false, rbac: false, live: false, multitenant: false }, 'items')
    assert.ok(planned.filesToDelete.includes('gateway/internal/store/db/items.sql.go'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planRemove refuses the built-in notes resource the core tests depend on', () => {
  assert.throws(() => planRemove({ root: '/nonexistent' }, 'notes'), /built-in example/)
})

test('checkProject verifies healthy project anchors and parity', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: true, rbac: false, live: false, multitenant: false }
    const report = checkProject(p)
    assert.equal(report.healthy, true)
    assert.equal(report.issues.length, 0)
    assert.ok(report.passed.length >= 6)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseSchemaText parses app settings and resources from blueprint YAML', () => {
  const yaml = `
app:
  name: bookstore
  web: preact
  rls: singleTenant
  modules:
    - eventbus
    - audit

resources:
  authors:
    fields:
      name: string!
      bio: text
  books:
    scope: authors
    fields:
      title: string!
      price: float:default(0)
`
  const { app, resources } = parseSchemaText(yaml)
  assert.equal(app.name, 'bookstore')
  assert.equal(app.web, 'preact')
  assert.equal(app.rls, 'singleTenant')
  assert.deepEqual(app.modules, ['eventbus', 'audit'])
  assert.equal(Object.keys(resources).length, 2)
  assert.ok(resources.authors)
  assert.ok(resources.books)
  assert.equal(resources.books.inScope, 'authors')
  assert.deepEqual(resources.authors.fields, ['name:string!', 'bio:text'])
  assert.deepEqual(resources.books.fields, ['title:string!', 'price:float:default(0)'])
})

test('parseSchemaText rejects what it would otherwise drop silently', () => {
  const base = 'app:\n  name: x\n  modules:\n    - auth\nresources:\n  tasks:\n    fields:\n      - title:string!\n'
  assert.doesNotThrow(() => parseSchemaText(base + '# a comment line\n      - meta:json:default({})\n'))
  assert.throws(() => parseSchemaText('app:\n  modules: [auth, ws]\n'), /line 2 .*block style/)
  assert.throws(() => parseSchemaText(base + 'pipelines:\n  - { on: tasks.create, name: x }\n'), /line 10 .*block style/)
  assert.throws(() => parseSchemaText(base.replace('name: x', 'name: x   # the app')), /line 2 .*comments/)
  assert.throws(() => parseSchemaText(base + '    just some text\n'), /line 9 .*not understood/)
  assert.throws(() => parseSchemaText('app:\n  name: x\n  - auth\n'), /line 3 .*not understood/)
})

test('listModules and activateModule opt into eventbus and audit', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, module: 'github.com/test/app' }
    const initialMods = listModules(p)
    const evMod = initialMods.find((m) => m.id === 'eventbus')
    assert.equal(evMod.active, false)

    // Activate eventbus
    const res = activateModule(p, TEMPLATE, 'eventbus')
    assert.equal(res.status, 'ok')
    assert.equal(res.alreadyActive, false)
    assert.ok(existsSync(join(dir, 'gateway/internal/events/events.go')))

    // Verify listModules now shows eventbus as active
    const updatedMods = listModules(p)
    assert.equal(updatedMods.find((m) => m.id === 'eventbus').active, true)

    // Activate audit
    const resAudit = activateModule(p, TEMPLATE, 'audit')
    assert.equal(resAudit.status, 'ok')
    assert.ok(existsSync(join(dir, 'gateway/internal/audit/audit.go')))
    assert.ok(existsSync(join(dir, 'gateway/internal/server/audit.go')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseFields and plan support :enum(...), :min(...) and :max(...) validation modifiers', () => {
  const dir = setupMockProject()
  try {
    const fields = parseFields(['status:string!:enum(draft,published,archived):min(3):max(20)', 'score:int:min(0):max(100)'])
    assert.deepEqual(fields[0].enumValues, ['draft', 'published', 'archived'])
    assert.equal(fields[0].defaultValue, 'draft')
    assert.equal(fields[0].minVal, 3)
    assert.equal(fields[0].maxVal, 20)
    assert.equal(fields[1].minVal, 0)
    assert.equal(fields[1].maxVal, 100)

    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const planned = plan(p, 'articles', fields)

    const handlerFile = planned.files.find((f) => f.path.includes('articles.go'))
    assert.ok(handlerFile)
    assert.ok(handlerFile.content.includes('status must be one of: draft, published, archived'))
    assert.ok(handlerFile.content.includes('status must have at least 3 characters'))
    assert.ok(handlerFile.content.includes('score must be at least 0'))
    assert.ok(handlerFile.content.includes('score must be at most 100'))
    assert.ok(handlerFile.content.includes('enum: [draft, published, archived]'))

    const def = planned.files.find((f) => f.path === 'web/src/resources/articles.ts')
    assert.ok(def)
    assert.ok(def.content.includes("options: ['draft', 'published', 'archived']"))
    assert.ok(planned.files.find((f) => f.path === 'web/src/pages/Articles.tsx').content.includes('<ResourcePage def={ArticlesDef}'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planSeed generates valid seed.sql with realistic mock data', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir }
    const planned = planSeed(p, 3)

    assert.equal(planned.status, 'ok')
    assert.equal(planned.count, 3)
    assert.equal(planned.tables.length, 1)
    assert.equal(planned.tables[0].table, 'items')
    assert.equal(planned.totalRecords, 3)
    assert.ok(planned.file.content.includes('INSERT OR IGNORE INTO items'))
    assert.ok(planned.file.content.includes('018e3d82-82c5-7b24-0001-000000000001'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('plan supports declarative UI layouts (cards, feed, chat)', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const fields = parseFields(['name:string!', 'bio:text', 'avatar_url:string', 'status:string!:enum(active,away)'])

    // 1. Cards layout
    const plannedCards = plan(p, 'profiles', fields, { ui: 'cards' })
    const cardsPage = plannedCards.files.find((f) => f.path.includes('Profiles.tsx'))
    assert.ok(cardsPage)
    assert.ok(cardsPage.content.includes('LayoutGrid'))
    const cardsDef = plannedCards.files.find((f) => f.path === 'web/src/resources/profiles.ts')
    assert.ok(cardsDef.content.includes("layout: 'cards'"))
    assert.ok(cardsDef.content.includes("name: 'avatar_url'"))

    // 2. Feed layout
    const plannedFeed = plan(p, 'posts', parseFields(['title:string!', 'content:text']), { ui: 'feed' })
    const feedPage = plannedFeed.files.find((f) => f.path.includes('Posts.tsx'))
    assert.ok(feedPage)
    assert.ok(feedPage.content.includes('Rss'))
    assert.ok(plannedFeed.files.find((f) => f.path === 'web/src/resources/posts.ts').content.includes("layout: 'feed'"))

    // 3. Chat layout
    const plannedChat = plan(p, 'messages', parseFields(['content:text!']), { ui: 'chat' })
    const chatPage = plannedChat.files.find((f) => f.path.includes('Messages.tsx'))
    assert.ok(chatPage)
    assert.ok(chatPage.content.includes('MessageSquare'))
    assert.ok(plannedChat.files.find((f) => f.path === 'web/src/resources/messages.ts').content.includes("layout: 'chat'"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planApply parses and wires declarative pipelines and UI layouts', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, module: 'github.com/test/app/gateway', auth: false, rbac: false, live: false, multitenant: false }
    const schemaYaml = `
resources:
  profiles:
    ui: cards
    fields:
      - display_name:string!
      - bio:text
  swipes:
    fields:
      - profile:ref:profiles!
      - target_id:string!
      - direction:string!:enum(like,pass)

pipelines:
  - on: swipes.create
    name: processMatch
    preset: match_reciprocal
    target: matches
`
    const planned = planApply(p, schemaYaml)
    assert.equal(planned.resources.length, 2)
    assert.equal(planned.resources[0].ui, 'cards')
    const profilesPage = planned.files.find((f) => f.path.includes('Profiles.tsx'))
    assert.ok(profilesPage)
    assert.ok(planned.files.find((f) => f.path === 'web/src/resources/profiles.ts').content.includes("layout: 'cards'"))

    const obsFile = planned.files.find((f) => f.path.includes('observers.go'))
    assert.ok(obsFile)
    assert.ok(obsFile.content.includes('s.Events.On("swipes.create", s.onProcessMatch)'))
    assert.ok(obsFile.content.includes('func (s *Server) onProcessMatch(ev events.Event)'))
    assert.ok(obsFile.content.includes('match_reciprocal'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--no-ui writes only the resource definition: no page, nav entry or link', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    const planned = plan(p, 'slots', parseFields(['starts_at:time!', 'note:text']), { ui: 'none' })
    const web = planned.files.filter((f) => f.path.startsWith('web/')).map((f) => f.path)
    assert.ok(web.includes('web/src/resources/slots.ts'))
    assert.ok(web.includes('web/src/lib/api.ts'), 'the types still exported')
    assert.ok(!web.some((x) => x.endsWith('.tsx')), `no tsx: ${web}`)
    const def = planned.files.find((f) => f.path === 'web/src/resources/slots.ts').content
    assert.ok(def.includes("url: '/slots'") && def.includes("type: 'time'"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--ui calendar needs a time field and writes where a row starts and ends', () => {
  const dir = setupMockProject()
  try {
    const p = { root: dir, auth: false, rbac: false, live: false, multitenant: false }
    assert.throws(() => plan(p, 'visits', parseFields(['name:string!']), { ui: 'calendar' }), /time field/)
    const planned = plan(p, 'visits', parseFields(['name:string!', 'starts_at:time!', 'ends_at:time']), { ui: 'calendar' })
    const def = planned.files.find((f) => f.path === 'web/src/resources/visits.ts').content
    assert.ok(def.includes("layout: 'calendar'"))
    assert.ok(def.includes("calendar: { start: 'starts_at', end: 'ends_at' },"))
    assert.ok(planned.files.find((f) => f.path === 'web/src/pages/Visits.tsx').content.includes('CalendarDays'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a resource gets permissions, a Create entry and a nav entry that follow them', () => {
  const dir = setupMockProject()
  try {
    const authed = plan({ root: dir, auth: true, rbac: false, live: false, multitenant: false }, 'visits', parseFields(['name:string!']), {})
    const def = authed.files.find((f) => f.path === 'web/src/resources/visits.ts').content
    assert.ok(def.includes("perms: { read: 'visits.read', write: 'visits.write' },"))
    const app = authed.files.find((f) => f.path === 'web/src/App.tsx').content
    assert.ok(app.includes("{ id: 'visits', label: t('Visits'), icon: VisitsIcon, show: () => allowed('visits.read') },"))
    assert.ok(app.includes("{ id: 'visits', label: t('Visit'), icon: <VisitsIcon size={14} />, perm: 'visits.write', run: VisitsNew },"))
    const open = plan({ root: dir, auth: false, rbac: false, live: false, multitenant: false }, 'visits', parseFields(['name:string!']), {})
    assert.ok(!open.files.find((f) => f.path === 'web/src/resources/visits.ts').content.includes('perms'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('module add takes the next migration number, the real Go module, and writes nothing on --dry-run', () => {
  const dir = setupMockProject()
  try {
    for (const d of ['sqlite', 'postgres']) writeFileSync(join(dir, `gateway/internal/store/migrations/${d}/00004_swipes.sql`), '-- +goose Up\n')
    const p = { root: dir, module: 'github.com/leandrofus/citas/gateway' }
    const before = (d) => readdirSync(join(dir, `gateway/internal/store/migrations/${d}`)).sort()

    const snapshot = before('sqlite').join()
    const dry = activateModule(p, TEMPLATE, 'rbac', { dry: true })
    assert.equal(dry.dryRun, true)
    assert.ok(dry.filesAdded.includes('gateway/internal/store/migrations/sqlite/00005_rbac_roles.sql'), dry.filesAdded.join())
    assert.ok(dry.filesAdded.includes('gateway/internal/store/migrations/sqlite/00006_rbac.sql'), dry.filesAdded.join())
    assert.ok(!existsSync(join(dir, 'gateway/internal/server/rbac.go')), 'dry run wrote rbac.go')
    assert.equal(before('sqlite').join(), snapshot)
    assert.ok(!before('postgres').some((f) => f.endsWith('_rbac.sql')))

    activateModule(p, TEMPLATE, 'rbac')
    for (const d of ['sqlite', 'postgres']) {
      assert.ok(before(d).includes('00004_swipes.sql'), 'the project migration stays')
      assert.ok(before(d).includes('00005_rbac_roles.sql'), `${d}: ${before(d)}`)
      assert.ok(before(d).includes('00006_rbac.sql'), `${d}: ${before(d)}`)
      assert.ok(!before(d).includes('00004_rbac.sql'))
    }
    const rbac = readFileSync(join(dir, 'gateway/internal/server/rbac.go'), 'utf8')
    assert.ok(rbac.includes('"github.com/leandrofus/citas/gateway/internal/auth"'), 'module path')
    assert.ok(!rbac.includes('gateway/gateway'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planSeed respects the enums, lengths and ranges the handler enforces', () => {
  const dir = setupMockProject()
  try {
    writeFileSync(join(dir, 'gateway/internal/server/items.go'), `package server
func checkItem() {
	_ = "priority must be one of: low, high"
	_ = "title must have at least 12 characters"
	_ = "title must have at most 14 characters"
}
`)
    const sql = planSeed({ root: dir }, 3).file.content
    const rows = sql.split('\n').filter((l) => l.startsWith('INSERT'))
    assert.equal(rows.length, 3)
    assert.ok(rows.every((r) => /'(low|high)'/.test(r)), rows[0])
    assert.ok(!sql.includes('Item 1'), 'no blind Item N')
    for (const r of rows) {
      const title = /VALUES \('[^']*', '([^']*)'/.exec(r)?.[1] ?? ''
      assert.ok(title.length >= 12 && title.length <= 14, `title "${title}"`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

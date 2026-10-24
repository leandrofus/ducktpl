import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findMatching,
  insertRoutesAst,
  insertPermsAst,
  insertCatalogAst,
  insertUserPermsAst,
  insertTsImportsAst,
  insertTsNavAst,
  insertTsPagesAst,
  insertTsApiTypesAst,
  insertTsLivePathsAst,
  smartInsert,
} from './ast.mjs'

test('findMatching correctly finds matching brackets respecting quotes, comments, escapes', () => {
  const code = `func Test() {
    // a line comment with }
    /* a block comment { with } nested */
    str := "hello { world \\"}"
    if true {
      x := 1
    }
  }`
  const openBrace = code.indexOf('{')
  const closeBrace = findMatching(code, openBrace, '{', '}')
  assert.equal(code[closeBrace], '}')
  assert.equal(closeBrace, code.length - 1)
})

test('smartInsert routes works without // ducktpl:routes anchor using AST boundaries', () => {
  const serverGo = `package server

import "net/http"

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/v1/health", s.health)
	mux.Handle("/api/", http.NotFoundHandler())
	return mux
}
`
  const routeLine = '\tmux.Handle("GET /api/v1/tasks", s.listTasks)\n'
  const result = smartInsert(serverGo, 'routes', routeLine, 'server.go')

  assert.ok(result.includes('GET /api/v1/tasks'))
  // Must be inserted before the /api/ fallback
  assert.ok(result.indexOf('GET /api/v1/tasks') < result.indexOf('mux.Handle("/api/"'))
})

test('smartInsert perms, catalog, and user-perms works without anchors', () => {
  const permsGo = `package auth

const (
	PermNotesRead = "notes.read"
)

var Catalog = []any{
	{PermNotesRead, "Read notes"},
}

var User = []any{
	PermNotesRead,
}
`
  let res = smartInsert(permsGo, 'perms', '\tPermTasksRead = "tasks.read"\n', 'perms.go')
  assert.ok(res.includes('PermTasksRead = "tasks.read"'))
  assert.ok(res.indexOf('PermTasksRead') < res.indexOf(')\n\nvar Catalog'))

  res = smartInsert(res, 'catalog', '\t{PermTasksRead, "Read tasks"},\n', 'perms.go')
  assert.ok(res.includes('{PermTasksRead, "Read tasks"}'))
  assert.ok(res.indexOf('{PermTasksRead') < res.indexOf('}\n\nvar User'))

  res = smartInsert(res, 'user-perms', '\tPermTasksRead,\n', 'perms.go')
  assert.ok(res.includes('\tPermTasksRead,\n}'))
})

test('smartInsert TypeScript imports, nav, and pages works without anchors', () => {
  const appTsx = `import React from 'react'
import { Notes } from './pages/Notes'

const NAV: NavItem[] = [
  { id: 'notes', label: 'Notes' },
]

function Shell() {
  switch (route.page) {
    case 'notes': return <Notes />
    default: return null
  }
}
`
  let res = smartInsert(appTsx, 'imports', "import { Tasks } from './pages/Tasks'\n", 'App.tsx')
  assert.ok(res.includes("import { Tasks } from './pages/Tasks'"))
  assert.ok(res.indexOf('import { Tasks }') > res.indexOf("import { Notes } from './pages/Notes'"))

  res = smartInsert(res, 'nav', "  { id: 'tasks', label: 'Tasks' },\n", 'App.tsx')
  assert.ok(res.includes("{ id: 'tasks', label: 'Tasks' }"))
  assert.ok(res.indexOf("{ id: 'tasks'") < res.indexOf(']\n\nfunction Shell'))

  res = smartInsert(res, 'pages', "    case 'tasks': return <Tasks />\n", 'App.tsx')
  assert.ok(res.includes("case 'tasks': return <Tasks />"))
  assert.ok(res.indexOf("case 'tasks'") < res.indexOf('default: return null'))
})

test('smartInsert api.ts types and live.ts paths works without anchors', () => {
  const apiTs = `export type Note = Schemas['Note']
`
  const resApi = smartInsert(apiTs, 'types', "export type Task = Schemas['Task']\n", 'api.ts')
  assert.ok(resApi.includes("export type Task = Schemas['Task']"))

  const liveTs = `const PATHS: Record<string, string> = {
  note: '/notes',
}
`
  const resLive = smartInsert(liveTs, 'live', "  task: '/tasks',\n", 'live.ts')
  assert.ok(resLive.includes("task: '/tasks'"))
  assert.ok(resLive.indexOf("task: '/tasks'") < resLive.indexOf('}\n'))
})

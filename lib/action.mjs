// action.mjs: generate custom RPC/Action endpoints for existing resources in create-duck projects.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resourceNames } from './generate.mjs'

const pascal = (s) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const camel = (s) => {
  const p = pascal(s)
  return p[0].toLowerCase() + p.slice(1)
}

export function planAction(p, resource, actionName, opts = {}) {
  const n = resourceNames(resource, opts.singular)
  const actName = actionName.toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (!actName) throw new Error('action name must be alphanumeric (e.g. complete, archive, send)')

  const Act = pascal(actName)
  const method = `${actName}${n.Singular}`

  const serverDir = join(p.root, 'gateway/internal/server')
  let handlerPath = null
  if (existsSync(serverDir)) {
    const sFiles = readdirSync(serverDir)
    if (sFiles.includes(`${n.table}.go`)) handlerPath = `gateway/internal/server/${n.table}.go`
    else if (sFiles.includes(`${n.one}.go`)) handlerPath = `gateway/internal/server/${n.one}.go`
  }

  if (!handlerPath) {
    throw new Error(`cannot add action: handler for "${n.table}" not found in gateway/internal/server/`)
  }

  const handlerText = readFileSync(join(p.root, handlerPath), 'utf8')
  if (handlerText.includes(`func (s *Server) ${method}(`)) {
    throw new Error(`action "${actName}" already exists on resource "${n.table}" (method ${method})`)
  }

  const files = []
  const notes = []

  // 1. Append action handler to resource Go file
  const actionCode = `
// openapi:operation POST /api/v1${n.url}/{id}/${actName}
// summary: ${Act} a ${n.one_label}
// tags: [${n.table}]
// responses:
//   200:
//     description: ${n.Singular} updated
//     content:
//       application/json:
//         schema: { $ref: '#/components/schemas/${n.Singular}' }
func (s *Server) ${method}(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	x, err := s.Store.Q.Get${n.Singular}(r.Context(), id)
	if err != nil {
		return fromStore(err, "${n.one}")
	}
	// Action logic: modify state or record event
	s.record(r, p, "${n.one}.${actName}", "${n.one}", id, nil)
	s.changed(r, "${n.one}", id)
	return s.writeJSON(w, http.StatusOK, to${n.Singular}(x))
}
`
  files.push({
    path: handlerPath,
    content: handlerText.trimEnd() + '\n' + actionCode,
    created: false,
  })

  // 2. Register route in server.go
  const serverPath = 'gateway/internal/server/server.go'
  if (existsSync(join(p.root, serverPath))) {
    const srvText = readFileSync(join(p.root, serverPath), 'utf8')
    const routeRule = p.auth ? (p.rbac ? `s.can(auth.Perm${n.Plural}Write, s.${method})` : `s.signedIn(s.${method})`) : `s.public(s.${method})`
    const routeLine = `\tmux.Handle("POST /api/v1${n.url}/{id}/${actName}", ${routeRule})\n`
    const anchorIdx = srvText.indexOf('// ducktpl:routes')
    if (anchorIdx !== -1) {
      const updated = srvText.slice(0, anchorIdx) + routeLine + srvText.slice(anchorIdx)
      files.push({ path: serverPath, content: updated, created: false })
    }
  }

  // 3. Add test in server test file
  const testFiles = [`gateway/internal/server/${n.table}_test.go`, `gateway/internal/server/${n.one}_test.go`]
  const testPath = testFiles.find((f) => existsSync(join(p.root, f)))
  if (testPath) {
    const testText = readFileSync(join(p.root, testPath), 'utf8')
    const testFunc = `
func Test${n.Singular}${Act}(t *testing.T) {
	c := newClient(t, newTestServer(t))
${p.auth ? '\tc.login("admin", "admin-password")\n' : ''}\tid := seed${n.Singular}(c)
	var out ${camel(n.one)}DTO
	c.must(200, "POST", "${n.url}/"+id+"/${actName}", nil, &out)
	if out.ID != id {
		t.Fatalf("expected ID %s, got %s", id, out.ID)
	}
}
`
    files.push({
      path: testPath,
      content: testText.trimEnd() + '\n' + testFunc,
      created: false,
    })
  }

  notes.push(`Added action "POST /api/v1${n.url}/{id}/${actName}" to ${n.table}`)

  return {
    action: actName,
    resource: n.table,
    method,
    route: `POST /api/v1${n.url}/{id}/${actName}`,
    files,
    notes,
  }
}

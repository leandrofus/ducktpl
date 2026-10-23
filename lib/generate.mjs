// ducktpl add: adds a resource to a project made with create-duck, through
// every layer of the add-an-endpoint loop (CLAUDE.md):
//
//   migration (both engines) → queries → handler with its OpenAPI blocks →
//   route → permissions (auth, rbac) → HTTP test → web page + nav
//
// It reads the project to know which modules it has, writes new files and
// inserts lines at the `ducktpl:<place>` anchors the template left behind.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TYPES = {
  string: { go: 'string', sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''", schema: '{ type: string }', ts: 'string', sample: '"example"', other: '"changed"', empty: "''" },
  text: { go: 'string', sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''", schema: '{ type: string }', ts: 'string', sample: '"some text"', other: '"other text"', empty: "''" },
  int: { go: 'int64', sqlite: 'INTEGER NOT NULL DEFAULT 0', pg: 'BIGINT NOT NULL DEFAULT 0', schema: '{ type: integer, format: int64 }', ts: 'number', sample: '42', other: '7', empty: '0' },
  float: { go: 'float64', sqlite: 'REAL NOT NULL DEFAULT 0', pg: 'DOUBLE PRECISION NOT NULL DEFAULT 0', schema: '{ type: number, format: double }', ts: 'number', sample: '1.5', other: '2.5', empty: '0' },
  bool: { go: 'bool', sqlite: 'BOOLEAN NOT NULL DEFAULT 0', pg: 'BOOLEAN NOT NULL DEFAULT false', schema: '{ type: boolean }', ts: 'boolean', sample: 'true', other: 'false', empty: 'false' },
}

const RESERVED = new Set(['id', 'created_at', 'updated_at'])

// ---- names ----

const pascal = (snake) => snake.split('_').map((w) => (w === 'id' ? 'ID' : w[0].toUpperCase() + w.slice(1))).join('')
const camel = (snake) => {
  const p = pascal(snake)
  return p[0].toLowerCase() + p.slice(1)
}

/** English singular, close to what sqlc (jinzhu/inflection) does for table names. */
export function singularize(w) {
  if (/ies$/.test(w)) return w.replace(/ies$/, 'y')
  if (/(ss|x|z|ch|sh)es$/.test(w)) return w.replace(/es$/, '')
  if (/ses$/.test(w)) return w.replace(/es$/, '')
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1)
  return w
}

export function resourceNames(plural, singular) {
  if (!/^[a-z][a-z0-9_]*$/.test(plural)) throw new Error(`resource "${plural}": lowercase letters, digits and underscores (e.g. tasks, work_items)`)
  singular ||= singularize(plural)
  if (singular === plural) throw new Error(`cannot tell the singular of "${plural}": pass --singular`)
  const words = plural.replace(/_/g, ' ')
  return {
    table: plural, // work_items
    one: singular, // work_item: object type, events, cache keys
    url: '/' + plural.replace(/_/g, '-'), // /work-items
    Plural: pascal(plural), // WorkItems
    Singular: pascal(singular), // WorkItem: DTO, sqlc model
    label: words[0].toUpperCase() + words.slice(1), // Work items
    one_label: singular.replace(/_/g, ' '), // work item
  }
}

export function parseFields(specs) {
  if (!specs.length) throw new Error('give at least one field, e.g. title:string! done:bool')
  const seen = new Set()
  return specs.map((spec) => {
    const m = /^([a-z][a-z0-9_]*):([a-z]+)(!?)$/.exec(spec)
    if (!m) throw new Error(`field "${spec}": write name:type, with ! for required (types: ${Object.keys(TYPES).join(', ')})`)
    const [, name, type, bang] = m
    if (!TYPES[type]) throw new Error(`field "${spec}": unknown type ${type} (${Object.keys(TYPES).join(', ')})`)
    if (RESERVED.has(name)) throw new Error(`field "${name}" is added for you`)
    if (seen.has(name)) throw new Error(`field "${name}" twice`)
    seen.add(name)
    return { name, type, required: !!bang, t: TYPES[type], Go: pascal(name) }
  })
}

// ---- the project ----

export function findProject(start) {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'gateway', 'go.mod')) && existsSync(join(dir, 'web', 'package.json'))) return dir
    const up = join(dir, '..')
    if (up === dir) throw new Error('not inside a create-duck project (no gateway/go.mod and web/package.json above here)')
    dir = up
  }
}

export function inspect(root) {
  const gw = join(root, 'gateway')
  const mod = /^module\s+(\S+)/m.exec(readFileSync(join(gw, 'go.mod'), 'utf8'))[1]
  const has = (p) => existsSync(join(root, p))
  return {
    root,
    module: mod,
    auth: has('gateway/internal/auth/perms.go'),
    rbac: has('gateway/internal/server/rbac.go'),
    live: has('web/src/lib/live.ts'),
  }
}

function nextMigration(root) {
  const dir = join(root, 'gateway/internal/store/migrations/sqlite')
  const nums = readdirSync(dir).map((f) => parseInt(f, 10)).filter((n) => !isNaN(n))
  return String(Math.max(0, ...nums) + 1).padStart(5, '0')
}

// ---- generated code ----

function migration(engine, n, f, p) {
  const ts = engine === 'pg' ? 'TIMESTAMPTZ' : 'DATETIME'
  const cols = f.map((x) => `    ${x.name.padEnd(10)} ${x.t[engine]},`).join('\n')
  let up = `-- +goose Up
CREATE TABLE ${n.table} (
    id         TEXT PRIMARY KEY,
${cols}
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL
);
`
  let down = `DROP TABLE ${n.table};\n`
  if (p.rbac) {
    // existing databases: the builtin user role gets the new permissions too
    up += `UPDATE roles SET permissions = permissions || ' ${n.table}.read ${n.table}.write' WHERE name = 'user';\n`
    down = `UPDATE roles SET permissions = replace(permissions, ' ${n.table}.read ${n.table}.write', '') WHERE name = 'user';\n` + down
  }
  return `${up}\n-- +goose Down\n${down}`
}

function queries(n, f) {
  const cols = f.map((x) => x.name)
  return `-- name: List${n.Plural} :many
SELECT * FROM ${n.table} ORDER BY updated_at DESC;

-- name: Get${n.Singular} :one
SELECT * FROM ${n.table} WHERE id = @id;

-- name: Create${n.Singular} :exec
INSERT INTO ${n.table} (id, ${cols.join(', ')}, created_at, updated_at)
VALUES (@id, ${cols.map((c) => '@' + c).join(', ')}, @now, @now);

-- name: Update${n.Singular} :exec
UPDATE ${n.table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @now WHERE id = @id;

-- name: Delete${n.Singular} :execrows
DELETE FROM ${n.table} WHERE id = @id;
`
}

function handler(n, f, p) {
  const S = n.Singular, P = n.Plural, dto = camel(n.one) + 'DTO'
  const w = Math.max(...f.map((x) => x.Go.length), 9)
  const pad = (s) => s.padEnd(w)
  const required = f.filter((x) => x.required)
  const strReq = required.filter((x) => x.t.go === 'string')
  const permRead = p.auth ? `auth.Perm${P}Read` : `"${n.table}.read"`
  const permWrite = p.auth ? `auth.Perm${P}Write` : `"${n.table}.write"`
  const validate = strReq.length
    ? strReq.map((x) => `	if strings.TrimSpace(v.${x.Go}) == "" {\n		return badRequest("${x.name} is required")\n	}`).join('\n') + '\n'
    : ''
  return `package server

import (
	"net/http"
${strReq.length ? '	"strings"\n' : ''}	"time"

${p.auth ? `	"${p.module}/internal/auth"\n` : ''}	"${p.module}/internal/store"
	"${p.module}/internal/store/db"
)

// Generated by ducktpl add ${n.table}. It is yours now: edit freely.

// openapi:schema ${S}
// type: object
// required: [id, ${f.map((x) => x.name).join(', ')}, created_at, updated_at]
// properties:
//   id: { type: string, format: uuid }
${f.map((x) => `//   ${x.name}: ${x.t.schema}`).join('\n')}
//   created_at: { type: string, format: date-time }
//   updated_at: { type: string, format: date-time }

type ${dto} struct {
	${pad('ID')} string    \`json:"id"\`
${f.map((x) => `	${pad(x.Go)} ${x.t.go.padEnd(9)} \`json:"${x.name}"\``).join('\n')}
	${pad('CreatedAt')} time.Time \`json:"created_at"\`
	${pad('UpdatedAt')} time.Time \`json:"updated_at"\`
}

func to${S}(x db.${S}) ${dto} {
	return ${dto}{ID: x.ID, ${f.map((x) => `${x.Go}: x.${x.Go}`).join(', ')}, CreatedAt: x.CreatedAt.UTC(), UpdatedAt: x.UpdatedAt.UTC()}
}

// openapi:schema Create${S}Request
// type: object
${required.length ? `// required: [${required.map((x) => x.name).join(', ')}]\n` : ''}// additionalProperties: false
// properties:
${f.map((x) => `//   ${x.name}: ${x.t.schema}`).join('\n')}

type create${S}Request struct {
${f.map((x) => `	${pad(x.Go)} ${x.t.go} \`json:"${x.name}"\``).join('\n')}
}

// openapi:schema Update${S}Request
// type: object
// additionalProperties: false
// properties:
${f.map((x) => `//   ${x.name}: ${x.t.schema}`).join('\n')}

type update${S}Request struct {
${f.map((x) => `	${pad(x.Go)} opt[${x.t.go}] \`json:"${x.name}"\``).join('\n')}
}

// check${S} validates a ${n.one_label} before it is written.
func check${S}(v *db.${S}) error {
${validate}	return nil
}

// openapi:operation
// summary: List ${n.label.toLowerCase()}
// responses:
//   '200': { description: All ${n.label.toLowerCase()} you may see, schema: '[]${S}' }

func (s *Server) list${P}(w http.ResponseWriter, r *http.Request, p principal) error {
	all, ids, err := s.visible(r, p, ${permRead}, "${n.one}")
	if err != nil {
		return err
	}
	xs, err := s.Store.Q.List${P}(r.Context())
	if err != nil {
		return err
	}
	out := make([]${dto}, 0, len(xs))
	for _, x := range xs {
		if all || ids[x.ID] {
			out = append(out, to${S}(x))
		}
	}
	return ok(w, out)
}

// openapi:operation
// summary: Get a ${n.one_label}
// responses:
//   '200': { description: The ${n.one_label}, schema: ${S} }

func (s *Server) get${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if err := s.allow(r, p, ${permRead}, "${n.one}", id); err != nil {
		return err
	}
	x, err := s.Store.Q.Get${S}(r.Context(), id)
	if err != nil {
		return fromStore(err, "${n.one_label}")
	}
	return ok(w, to${S}(x))
}

// openapi:operation
// summary: Create a ${n.one_label}
// requestBody: { schema: Create${S}Request }
// responses:
//   '201': { description: Created, schema: ${S} }

func (s *Server) create${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleCreated(w, r, func(req create${S}Request) (${dto}, error) {
		v := db.${S}{${f.map((x) => `${x.Go}: req.${x.Go}`).join(', ')}}
		if err := check${S}(&v); err != nil {
			return ${dto}{}, err
		}
		id := store.NewID()
		err := s.Store.Q.Create${S}(r.Context(), db.Create${S}Params{ID: id, ${f.map((x) => `${x.Go}: v.${x.Go}`).join(', ')}, Now: store.Now()})
		if err != nil {
			return ${dto}{}, fromStore(err, "${n.one_label}")
		}
		x, err := s.Store.Q.Get${S}(r.Context(), id)
		if err != nil {
			return ${dto}{}, err
		}
		s.record(r, p, "${n.one}.create", "${n.one}", id, nil)
		s.changed(r, "${n.one}", id)
		return to${S}(x), nil
	})
}

// openapi:operation
// summary: Update a ${n.one_label}
// description: Only the fields present change.
// requestBody: { schema: Update${S}Request }
// responses:
//   '200': { description: Updated, schema: ${S} }

func (s *Server) update${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	return handleAction(w, r, func(req update${S}Request) (${dto}, error) {
		id := r.PathValue("id")
		if err := s.allow(r, p, ${permWrite}, "${n.one}", id); err != nil {
			return ${dto}{}, err
		}
		var out db.${S}
		err := s.Store.Tx(r.Context(), func(q *db.Queries) error {
			v, err := q.Get${S}(r.Context(), id)
			if err != nil {
				return fromStore(err, "${n.one_label}")
			}
${f.map((x) => `			if req.${x.Go}.Set {\n				v.${x.Go} = req.${x.Go}.V\n			}`).join('\n')}
			if err := check${S}(&v); err != nil {
				return err
			}
			if err := q.Update${S}(r.Context(), db.Update${S}Params{ID: id, ${f.map((x) => `${x.Go}: v.${x.Go}`).join(', ')}, Now: store.Now()}); err != nil {
				return fromStore(err, "${n.one_label}")
			}
			out, err = q.Get${S}(r.Context(), id)
			return err
		})
		if err != nil {
			return ${dto}{}, err
		}
		s.record(r, p, "${n.one}.update", "${n.one}", id, nil)
		s.changed(r, "${n.one}", id)
		return to${S}(out), nil
	})
}

// openapi:operation
// summary: Delete a ${n.one_label}
// responses:
//   '204': { description: Deleted }

func (s *Server) delete${S}(w http.ResponseWriter, r *http.Request, p principal) error {
	id := r.PathValue("id")
	if err := s.allow(r, p, ${permWrite}, "${n.one}", id); err != nil {
		return err
	}
	return handleCommand(w, func() error {
${p.rbac ? `		if err := s.Store.Q.DeleteObjectGrants(r.Context(), db.DeleteObjectGrantsParams{ObjectType: "${n.one}", ObjectID: id}); err != nil {\n			return err\n		}\n` : ''}		n, err := s.Store.Q.Delete${S}(r.Context(), id)
		if err != nil {
			return err
		}
		if n == 0 {
			return notFound("${n.one_label}")
		}
		s.record(r, p, "${n.one}.delete", "${n.one}", id, nil)
		s.changed(r, "${n.one}", id)
		return nil
	})
}
`
}

function routes(n, p) {
  const S = n.Singular, P = n.Plural, u = '/api/v1' + n.url
  const any = (h) => (p.auth ? `s.signedIn(s.${h})` : `s.public(s.${h})`)
  const create = p.auth ? `s.can(auth.Perm${P}Write, s.create${S})` : `s.public(s.create${S})`
  return `	mux.Handle("GET ${u}", ${any('list' + P)})
	mux.Handle("POST ${u}", ${create})
	mux.Handle("GET ${u}/{id}", ${any('get' + S)})
	mux.Handle("PATCH ${u}/{id}", ${any('update' + S)})
	mux.Handle("DELETE ${u}/{id}", ${any('delete' + S)})

`
}

function test(n, f, p) {
  const S = n.Singular, dto = camel(n.one) + 'DTO'
  const body = (k) => '{' + f.map((x) => `"${x.name}": ${x.t[k]}`).join(', ') + '}'
  const first = f[0]
  return `package server

import "testing"

func Test${n.Plural}(t *testing.T) {
	c := newClient(t, newTestServer(t))
${p.auth ? '	c.login("admin", "admin-password")\n' : ''}	var x ${dto}
	c.must(201, "POST", "${n.url}", map[string]any${body('sample')}, &x)
	if x.ID == "" || x.${first.Go} != ${first.t.sample} {
		t.Fatalf("created %+v", x)
	}
	c.must(200, "GET", "${n.url}/"+x.ID, nil, nil)
	c.must(200, "PATCH", "${n.url}/"+x.ID, map[string]any{"${first.name}": ${first.t.other}}, &x)
	if x.${first.Go} != ${first.t.other} {
		t.Fatalf("patched %+v", x)
	}
	c.must(400, "POST", "${n.url}", map[string]any{"nope": 1}, nil)
${f.filter((x) => x.required && x.t.go === 'string').map((x) => `	c.must(400, "PATCH", "${n.url}/"+x.ID, map[string]any{"${x.name}": ""}, nil)\n`).join('')}	var list []${dto}
	c.must(200, "GET", "${n.url}", nil, &list)
	if len(list) != 1 {
		t.Fatalf("list %+v", list)
	}
	c.must(204, "DELETE", "${n.url}/"+x.ID, nil, nil)
	c.must(404, "GET", "${n.url}/"+x.ID, nil, nil)
}
`
}

function page(n, f) {
  const S = n.Singular, P = n.Plural
  const control = (x) => {
    const set = (val) => `onChange={(e) => setV({ ...v, ${x.name}: ${val} })}`
    switch (x.type) {
      case 'bool': return `<label className="check"><input type="checkbox" checked={v.${x.name}} ${set('e.currentTarget.checked')} /> {t('${label(x.name)}')}</label>`
      case 'text': return `<Field label={t('${label(x.name)}')}><textarea rows={4} value={v.${x.name}} ${set('e.currentTarget.value')} /></Field>`
      case 'int': return `<Field label={t('${label(x.name)}')}><input type="number" step={1} value={v.${x.name}} ${set('Math.trunc(Number(e.currentTarget.value))')} /></Field>`
      case 'float': return `<Field label={t('${label(x.name)}')}><input type="number" step="any" value={v.${x.name}} ${set('Number(e.currentTarget.value)')} /></Field>`
      default: return `<Field label={t('${label(x.name)}')}><input value={v.${x.name}} ${set('e.currentTarget.value')} /></Field>`
    }
  }
  const cell = (x) => {
    switch (x.type) {
      case 'bool': return `(x) => (x.${x.name} ? <Check size={14} /> : null)`
      case 'text': return `(x) => <span className="muted small ellipsis">{x.${x.name}.split('\\n')[0]}</span>`
      default: return `(x) => <span>{x.${x.name}}</span>`
    }
  }
  const cols = f.slice(0, 4)
  const required = f.filter((x) => x.required && x.t.ts === 'string')
  return `import { t } from '../i18n'
import { useMemo, useState } from 'react'
import { ListTodo, Plus, Search, X, Pencil, Trash2${f.some((x) => x.type === 'bool') ? ', Check' : ''} } from 'lucide-react'
import { api, enc } from '../lib/api'
import type { ${S} } from '../lib/api'
import { invalidate, useResource } from '../lib/store'
import { ago, dateTime } from '../lib/format'
import type { MenuEntry } from '../ui/ContextMenu'
import { DataTable, Empty, Spinner } from '../ui/common'
import { Modal, confirm, openDialog, toast } from '../ui/overlays'
import { Field } from '../ui/Field'

// Generated by ducktpl add ${n.table}. It is yours now: edit freely.

export const ${P}Icon = ListTodo

function actions(x: ${S}): MenuEntry[] {
  return [
    { header: x.${f[0].name}${f[0].t.ts === 'string' ? '' : '.toString()'} || x.id },
    { label: t('Edit…'), icon: <Pencil size={14} />, onClick: () => openDialog((c) => <${S}Dialog initial={x} onClose={c} />) },
    'sep',
    {
      label: t('Delete'), icon: <Trash2 size={14} />, danger: true, onClick: async () => {
        if (!(await confirm({ title: t('Delete this ${n.one_label}?'), body: t('This cannot be undone.'), danger: true, confirm: t('Delete') }))) return
        api.del(\`${n.url}/\${enc(x.id)}\`).then(() => invalidate('${n.url}'), toast.err)
      },
    },
  ]
}

export function ${P}() {
  const { data, error, loading } = useResource<${S}[]>('${n.url}')
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\\s+/).filter(Boolean)
    return (data || []).filter((x) => words.every((w) => JSON.stringify(x).toLowerCase().includes(w)))
  }, [data, q])
  const create = () => openDialog((c) => <${S}Dialog onClose={c} />)
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <ListTodo size={20} />
          <h1>{t('${n.label}')}</h1>
          <span className="count">{data?.length ?? 0}</span>
          {loading && <Spinner />}
        </div>
        <div className="page-actions">
          <div className="search">
            <Search size={14} />
            <input placeholder={t('Search…')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            {q && <button className="icon-btn" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={create}><Plus size={14} /> {t('New')}</button>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-bad">{error.message}</div>}
        {data && data.length === 0 ? (
          <Empty icon={<ListTodo size={28} />} title={t('Nothing here yet')} action={<button className="btn btn-primary" onClick={create}><Plus size={14} /> {t('New')}</button>} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(x) => x.id}
            onOpen={(x) => openDialog((c) => <${S}Dialog initial={x} onClose={c} />)}
            rowMenu={actions}
            defaultSort={{ key: 'updated', dir: -1 }}
            columns={[
${cols.map((x) => `              { key: '${x.name}', label: t('${label(x.name)}'), sort: (x) => ${x.type === 'bool' ? `(x.${x.name} ? 1 : 0)` : `x.${x.name}`}, render: ${cell(x)} },`).join('\n')}
              { key: 'updated', label: t('Updated'), sort: (x) => x.updated_at, render: (x) => <span className="muted small" title={dateTime(x.updated_at)}>{ago(x.updated_at)}</span> },
            ]}
          />
        )}
      </div>
    </div>
  )
}

function ${S}Dialog({ initial, onClose }: { initial?: ${S}; onClose: () => void }) {
  const [v, setV] = useState({
${f.map((x) => `    ${x.name}: initial?.${x.name} ?? ${x.t.empty},`).join('\n')}
  })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      if (initial) await api.patch(\`${n.url}/\${enc(initial.id)}\`, v)
      else await api.post('${n.url}', v)
      invalidate('${n.url}')
      onClose()
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? t('Edit ${n.one_label}') : t('New ${n.one_label}')}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn btn-primary" disabled={busy${required.map((x) => ` || !v.${x.name}.trim()`).join('')}} onClick={submit}>{initial ? t('Save') : t('Create')}</button>
      </>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
${f.map((x) => '        ' + control(x)).join('\n')}
      </form>
    </Modal>
  )
}
`
}

function label(name) {
  const s = name.replace(/_/g, ' ')
  return s[0].toUpperCase() + s.slice(1)
}

// ---- inserting at anchors ----

function insert(text, anchor, lines, file) {
  const re = new RegExp(`^([ \\t]*)(//|#) ducktpl:${anchor}\\b.*$`, 'm')
  const m = re.exec(text)
  if (!m) throw new Error(`${file}: anchor "ducktpl:${anchor}" not found; add the lines by hand`)
  return text.slice(0, m.index) + lines + text.slice(m.index)
}

/**
 * Plans every change: { files: [{path, content, exists}] }. Nothing is
 * written until apply().
 */
export function plan(p, n, fields) {
  const out = []
  const add = (path, content) => {
    if (existsSync(join(p.root, path))) throw new Error(`${path} already exists: is "${n.table}" already there?`)
    out.push({ path, content, created: true })
  }
  const patch = (path, fn) => {
    const prev = out.find((x) => x.path === path)
    const cur = prev ? prev.content : readFileSync(join(p.root, path), 'utf8')
    const next = fn(cur)
    if (prev) prev.content = next
    else out.push({ path, content: next, created: false })
  }
  if (existsSync(join(p.root, 'gateway/internal/store/queries', n.table + '.sql'))) throw new Error(`queries/${n.table}.sql already exists: is "${n.table}" already there?`)
  const num = nextMigration(p.root)
  add(`gateway/internal/store/migrations/sqlite/${num}_${n.table}.sql`, migration('sqlite', n, fields, p))
  add(`gateway/internal/store/migrations/postgres/${num}_${n.table}.sql`, migration('pg', n, fields, p))
  add(`gateway/internal/store/queries/${n.table}.sql`, queries(n, fields))
  add(`gateway/internal/server/${n.table}.go`, handler(n, fields, p))
  add(`gateway/internal/server/${n.table}_test.go`, test(n, fields, p))
  patch('gateway/internal/server/server.go', (s) => insert(s, 'routes', routes(n, p), 'server.go'))
  if (p.auth) {
    const P = n.Plural
    patch('gateway/internal/auth/perms.go', (s) => {
      s = insert(s, 'perms', `	Perm${P}Read  = "${n.table}.read"\n	Perm${P}Write = "${n.table}.write"\n`, 'perms.go')
      s = insert(s, 'catalog', `	{Perm${P}Read, "Read every ${n.one_label}"},\n	{Perm${P}Write, "Create, edit and delete every ${n.one_label}"},\n`, 'perms.go')
      return insert(s, 'user-perms', `		Perm${P}Read, Perm${P}Write,\n`, 'perms.go')
    })
  }
  if (p.rbac) {
    patch('gateway/internal/server/rbac.go', (s) => insert(s, 'objects', `	"${n.one}": {auth.Perm${n.Plural}Read, auth.Perm${n.Plural}Write},\n`, 'rbac.go'))
  }
  add(`web/src/pages/${n.Plural}.tsx`, page(n, fields))
  patch('web/src/lib/api.ts', (s) => insert(s, 'types', `export type ${n.Singular} = Schemas['${n.Singular}']\n`, 'api.ts'))
  patch('web/src/App.tsx', (s) => {
    s = insert(s, 'imports', `import { ${n.Plural}, ${n.Plural}Icon } from './pages/${n.Plural}'\n`, 'App.tsx')
    s = insert(s, 'nav', `  { id: '${n.url.slice(1)}', label: t('${n.label}'), icon: ${n.Plural}Icon },\n`, 'App.tsx')
    return insert(s, 'pages', `    case '${n.url.slice(1)}': page = <${n.Plural} />; break\n`, 'App.tsx')
  })
  if (p.live) patch('web/src/lib/live.ts', (s) => insert(s, 'live', `  ${n.one}: '${n.url}',\n`, 'live.ts'))
  return out
}

export function apply(root, files) {
  for (const f of files) writeFileSync(join(root, f.path), f.content)
}

// Every optional module. `requires` are switched on with it.
export const FEATURES = [
  { id: 'eventbus', label: 'Domain EventBus', hint: 'in-process & Redis publish/subscribe for domain events and observers' },
  { id: 'auth', label: 'Auth', hint: 'local users, sessions, permissions per role, login page' },
  { id: 'rbac', label: 'Granular permissions', hint: 'editable roles + grants per object (user or role → permission on one object)', requires: ['auth'] },
  { id: 'pam', label: 'PAM', hint: 'system users sign in (ducktainer style: -tags pam, root helper, groups → roles)', requires: ['auth'] },
  { id: 'audit', label: 'Audit log', hint: 'tamper-evident HMAC hash chain, append-only table' },
  { id: 'ws', label: 'WebSockets', hint: 'live events at /api/v1/ws', requires: ['eventbus'] },
  { id: 'sse', label: 'Server-Sent Events', hint: 'live events at /api/v1/events', requires: ['eventbus'] },
  { id: 'redis', label: 'Redis', hint: 'shared cache, and events across gateways (falls back to memory)' },
  { id: 's3', label: 'S3 files', hint: 'attachments in S3/MinIO (falls back to a directory)' },
  { id: 'ssr', label: 'SSR', hint: 'duckforum style: Go renders head + content into the built index.html' },
  { id: 'ci', label: 'CI + releases', hint: 'GitHub Actions: tests, version tags, static Linux binaries' },
  { id: 'site', label: 'Docs site', hint: 'Astro site for GitHub Pages' },
]

export const WEBS = [
  { id: 'react', label: 'React 19' },
  { id: 'preact', label: 'Preact (same code through preact/compat, smaller bundle)' },
]

export const TENANTS = [
  { id: 'singleTenant', label: 'Single-tenant', hint: 'single organization or tenant per instance' },
  { id: 'multitenant', label: 'Multi-tenant (RLS)', hint: 'Row-Level Security with tenant isolation' },
]

/** The configuration the template is written for: everything on, React, singleTenant. */
export function defaults() {
  const cfg = Object.fromEntries(FEATURES.map((f) => [f.id, true]))
  for (const w of WEBS) cfg[w.id] = w.id === 'react'
  for (const t of TENANTS) cfg[t.id] = t.id === 'singleTenant'
  return cfg
}

/** Builds a configuration from chosen feature ids, a web framework and tenant/RLS model. */
export function configure(ids, web, tenant = 'singleTenant') {
  const known = new Set(FEATURES.map((f) => f.id))
  const on = new Set()
  const add = (id) => {
    if (!known.has(id)) throw new Error(`unknown module "${id}" (known: ${[...known].join(', ')})`)
    if (on.has(id)) return
    on.add(id)
    for (const r of FEATURES.find((f) => f.id === id).requires || []) add(r)
  }
  ids.forEach(add)
  if (!WEBS.some((w) => w.id === web)) throw new Error(`unknown web framework "${web}" (react or preact)`)

  const cleanTenant = (tenant || '').toLowerCase().replace(/[-_]/g, '')
  const normTenant = TENANTS.find((t) => t.id.toLowerCase() === cleanTenant)?.id
  if (!normTenant) throw new Error(`unknown tenant/RLS option "${tenant}" (singleTenant or multitenant)`)

  const cfg = Object.fromEntries(FEATURES.map((f) => [f.id, on.has(f.id)]))
  for (const w of WEBS) cfg[w.id] = w.id === web
  for (const t of TENANTS) cfg[t.id] = t.id === normTenant
  return cfg
}

// remove.mjs: clean removal of resources scaffolded with ducktpl.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { resourceNames } from './generate.mjs'

export function planRemove(p, resource, opts = {}) {
  let n
  try {
    n = resourceNames(resource, opts.singular)
  } catch {
    n = {
      table: resource,
      one: resource.replace(/s$/, ''),
      url: '/' + resource.replace(/_/g, '-'),
      Plural: resource[0].toUpperCase() + resource.slice(1),
      Singular: resource[0].toUpperCase() + resource.slice(1).replace(/s$/, ''),
      label: resource,
    }
  }

  const filesToDelete = []
  const filesToPatch = []
  const notes = []

  const checkDelete = (relPath) => {
    if (existsSync(join(p.root, relPath))) {
      filesToDelete.push(relPath)
    }
  }

  // 1. Migrations
  const sqliteDir = join(p.root, 'gateway/internal/store/migrations/sqlite')
  if (existsSync(sqliteDir)) {
    for (const f of readdirSync(sqliteDir)) {
      if (f.endsWith(`_${n.table}.sql`)) {
        filesToDelete.push(`gateway/internal/store/migrations/sqlite/${f}`)
      }
    }
  }

  const pgDir = join(p.root, 'gateway/internal/store/migrations/postgres')
  if (existsSync(pgDir)) {
    for (const f of readdirSync(pgDir)) {
      if (f.endsWith(`_${n.table}.sql`)) {
        filesToDelete.push(`gateway/internal/store/migrations/postgres/${f}`)
      }
    }
  }

  // 2. Query
  checkDelete(`gateway/internal/store/queries/${n.table}.sql`)

  // 3. Handlers and tests
  checkDelete(`gateway/internal/server/${n.table}.go`)
  checkDelete(`gateway/internal/server/${n.table}_test.go`)
  checkDelete(`gateway/internal/server/${n.one}.go`)
  checkDelete(`gateway/internal/server/${n.one}_test.go`)

  // 4. Web page
  checkDelete(`web/src/pages/${n.Plural}.tsx`)

  // 5. Patches for anchored files
  const patchFile = (relPath, removeRegexes) => {
    const full = join(p.root, relPath)
    if (!existsSync(full)) return
    let content = readFileSync(full, 'utf8')
    let orig = content
    for (const re of removeRegexes) {
      content = content.replace(re, '')
    }
    if (content !== orig) {
      filesToPatch.push({ path: relPath, content, created: false })
    }
  }

  // Server routes
  patchFile('gateway/internal/server/server.go', [
    new RegExp(`^\\s*mux\\.Handle\\([^\\n]*${n.url}[^\\n]*\\)\\n?`, 'gm'),
  ])

  // Auth perms
  patchFile('gateway/internal/auth/perms.go', [
    new RegExp(`^\\s*Perm${n.Plural}(Read|Write)\\s*=\\s*[^\\n]*\\n?`, 'gm'),
    new RegExp(`^\\s*\\{Perm${n.Plural}(Read|Write)[^\\n]*\\},\\n?`, 'gm'),
    new RegExp(`^\\s*Perm${n.Plural}(Read|Write),\\n?`, 'gm'),
  ])

  // RBAC objects
  patchFile('gateway/internal/server/rbac.go', [
    new RegExp(`^\\s*"${n.one}":\\s*\\{[^\\n]*\\},\\n?`, 'gm'),
  ])

  // UI api types
  patchFile('web/src/lib/api.ts', [
    new RegExp(`^export type (Paginated)?${n.Singular}\\b[^\\n]*\\n?`, 'gm'),
    new RegExp(`^export type Paginated${n.Plural}\\b[^\\n]*\\n?`, 'gm'),
  ])

  // UI App.tsx
  patchFile('web/src/App.tsx', [
    new RegExp(`^import\\s+\\{[^}]*${n.Plural}[^}]*\\}\\s+from\\s+['"]\\./pages/${n.Plural}['"]\\n?`, 'gm'),
    new RegExp(`^\\s*\\{\\s*id:\\s*['"]${n.url.slice(1)}['"][^\\n]*\\},\\n?`, 'gm'),
    new RegExp(`^\\s*case\\s*['"]${n.url.slice(1)}['"]:\\s*page\\s*=[^\\n]*break\\n?`, 'gm'),
  ])

  // Live events
  patchFile('web/src/lib/live.ts', [
    new RegExp(`^\\s*${n.one}:\\s*['"]${n.url}['"],?\\n?`, 'gm'),
  ])

  notes.push(`Prepared removal of resource "${n.table}" (${filesToDelete.length} files to delete, ${filesToPatch.length} files to patch)`)

  return {
    table: n.table,
    filesToDelete,
    filesToPatch,
    notes,
  }
}

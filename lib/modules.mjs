// modules.mjs: late opt-in activation of optional modules in existing projects.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { FEATURES, defaults } from './features.mjs'
import { processText } from './markers.mjs'
import { names, substitute } from './scaffold.mjs'

export function listModules(p) {
  const activeSet = new Set(['auth', 'rbac', 'live', 'multitenant', 'eventbus', 'audit', 'redis', 's3', 'ws', 'sse', 'pam', 'ssr', 'ci', 'site'].filter((m) => {
    if (m === 'auth') return existsSync(join(p.root, 'gateway/internal/auth/perms.go'))
    if (m === 'rbac') return existsSync(join(p.root, 'gateway/internal/server/rbac.go'))
    if (m === 'audit') return existsSync(join(p.root, 'gateway/internal/audit/audit.go'))
    if (m === 'eventbus') return existsSync(join(p.root, 'gateway/internal/events/events.go'))
    if (m === 's3') return existsSync(join(p.root, 'gateway/internal/objstore'))
    if (m === 'redis') return existsSync(join(p.root, 'gateway/internal/cache/redis.go'))
    if (m === 'ws') return existsSync(join(p.root, 'gateway/internal/server/ws.go'))
    if (m === 'sse') return existsSync(join(p.root, 'gateway/internal/server/sse.go'))
    if (m === 'pam') return existsSync(join(p.root, 'gateway/internal/auth/pam.go'))
    if (m === 'ssr') return existsSync(join(p.root, 'gateway/internal/server/ssr.go'))
    if (m === 'ci') return existsSync(join(p.root, '.github/workflows'))
    if (m === 'site') return existsSync(join(p.root, 'site'))
    return false
  }))

  return FEATURES.map((f) => ({
    id: f.id,
    label: f.label,
    hint: f.hint,
    requires: f.requires || [],
    active: activeSet.has(f.id),
  }))
}

const TEXT_EXTS = /\.(go|mod|sum|ts|tsx|mjs|js|json|css|html|md|ya?ml|sql|sh|txt|toml|astro|svg|service|socket|example)$|(^|\/)(Makefile|Dockerfile|_gitignore|\.gitkeep)$/

// what sqlc, openapi-gen and the UI build write: regenerated after a module, never merged
const GENERATED = /(^|\/)(store\/db\/|openapi\.yaml$|api-types\.ts$|server\/ui\/)/

export function activateModule(p, templateDir, moduleId, opts = {}) {
  const feat = FEATURES.find((f) => f.id === moduleId)
  if (!feat) {
    throw new Error(`unknown module "${moduleId}" (known: ${FEATURES.map((f) => f.id).join(', ')})`)
  }

  const modules = listModules(p)
  const current = modules.find((m) => m.id === moduleId)
  if (current && current.active) {
    return {
      status: 'ok',
      alreadyActive: true,
      module: moduleId,
      message: `Module "${moduleId}" is already active in this project.`,
      filesAdded: [],
    }
  }

  // Check requirements
  for (const req of feat.requires || []) {
    const reqMod = modules.find((m) => m.id === req)
    if (!reqMod || !reqMod.active) {
      throw new Error(`module "${moduleId}" requires "${req}" to be active first (run: ducktpl module add ${req})`)
    }
  }

  // Build config object for template markers
  const defs = defaults()
  const cfg = { ...defs }
  for (const m of modules) {
    cfg[m.id] = m.active
  }
  cfg[moduleId] = true

  // The names the template was made with: p.module is gateway/go.mod's, <host>/<owner>/<name>/gateway.
  const root = p.module.replace(/\/gateway$/, '')
  const parts = root.split('/')
  const owner = parts.length > 1 ? parts[parts.length - 2] : 'owner'
  const name = parts[parts.length - 1] || 'app'
  const n = { ...names(name, owner), module: root }
  const dry = !!opts.dry

  const filesAdded = []

  // --dry-run: say what would change, write nothing. Otherwise remember what was there, to undo.
  const undo = [] // { path, prev: string | null }
  const write = (path, content) => {
    if (dry) return
    undo.push({ path, prev: existsSync(path) ? readFileSync(path, 'utf8') : null })
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }

  const copyAndProcessFile = (relPath, destRel = relPath) => {
    const src = join(templateDir, relPath)
    const dest = join(p.root, destRel)
    if (!existsSync(src)) return

    if (TEXT_EXTS.test(relPath)) {
      const raw = readFileSync(src, 'utf8')
      const proc = processText(raw, cfg, defs, { file: relPath })
      if (!proc.keep) return
      write(dest, substitute(proc.text, n))
    } else if (!dry) {
      undo.push({ path: dest, prev: null })
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(src, dest)
    }
    filesAdded.push(destRel)
  }

  // A module's migration goes at the end of the project's: goose applies them
  // in number order, and the project already has numbers of its own.
  const migrationNumbers = ['sqlite', 'postgres'].flatMap((d) => {
    const dir = join(p.root, 'gateway/internal/store/migrations', d)
    return existsSync(dir) ? readdirSync(dir).map((f) => parseInt(f, 10)).filter((x) => !isNaN(x)) : []
  })
  let nextMigration = Math.max(0, ...migrationNumbers) + 1
  // Without rbac, auth keeps no roles table and users.role is CHECK (role IN ('admin', 'user')):
  // a role that is not one of those two is refused. The module moves roles into a table.
  const upgradeRoles = () => {
    const migrations = (d) => {
      const dir = join(p.root, 'gateway/internal/store/migrations', d)
      return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(dir, f), 'utf8')) : []
    }
    if (migrations('sqlite').some((t) => /CREATE TABLE roles\b/i.test(t))) return
    // what the user role may do, as the project's perms.go has it
    const perms = join(p.root, 'gateway/internal/auth/perms.go')
    let user = ''
    if (existsSync(perms)) {
      const go = readFileSync(perms, 'utf8')
      const consts = Object.fromEntries([...go.matchAll(/\b(Perm\w+)\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]))
      const list = /"user":\s*\{([^}]*)\}/.exec(go)?.[1] ?? ''
      user = [...list.matchAll(/\bPerm\w+/g)].map((m) => consts[m[0]]).filter(Boolean).join(' ')
    }
    const num = String(nextMigration++).padStart(5, '0')
    const roles = (bool) => `CREATE TABLE roles (
    name        TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT '',
    builtin     BOOLEAN NOT NULL DEFAULT ${bool ? 'false' : '0'}
);
INSERT INTO roles (name, description, permissions, builtin) VALUES
    ('admin', 'Everything', '*', ${bool ? 'true' : '1'}),
    ('user', 'Default role', '${user}', ${bool ? 'true' : '1'});`
    const usersCols = 'id, username, display_name, password_hash, source, role, disabled, created_at, updated_at, last_login_at'
    const usersTable = (name, role) => `CREATE TABLE ${name} (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'pam')),
    role          ${role},
    disabled      BOOLEAN NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL,
    last_login_at DATETIME
);`
    const sqlite = `-- +goose NO TRANSACTION
-- +goose Up
-- Roles become rows (the rbac module), so users.role refers to one instead of being
-- limited to 'admin' and 'user'. SQLite cannot drop a CHECK: the table is rebuilt.
PRAGMA foreign_keys = OFF;
${roles(false)}
${usersTable('users_new', "TEXT NOT NULL DEFAULT 'user' REFERENCES roles (name) ON UPDATE CASCADE")}
INSERT INTO users_new (${usersCols}) SELECT ${usersCols} FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
PRAGMA foreign_keys = ON;

-- +goose Down
PRAGMA foreign_keys = OFF;
${usersTable('users_old', "TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'))")}
INSERT INTO users_old (${usersCols}) SELECT ${usersCols} FROM users;
DROP TABLE users;
ALTER TABLE users_old RENAME TO users;
DROP TABLE roles;
PRAGMA foreign_keys = ON;
`
    const postgres = `-- +goose Up
-- Roles become rows (the rbac module), so users.role refers to one instead of being
-- limited to 'admin' and 'user'.
${roles(true)}
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles (name) ON UPDATE CASCADE;

-- +goose Down
ALTER TABLE users DROP CONSTRAINT users_role_fkey;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'));
DROP TABLE roles;
`
    for (const [d, text] of [['sqlite', sqlite], ['postgres', postgres]]) {
      const rel = `gateway/internal/store/migrations/${d}/${num}_rbac_roles.sql`
      write(join(p.root, rel), text)
      filesAdded.push(rel)
    }
  }

  const copyMigration = (file) => {
    const name = file.replace(/^\d+_/, '')
    const have = ['sqlite', 'postgres'].some((d) => {
      const dir = join(p.root, 'gateway/internal/store/migrations', d)
      return existsSync(dir) && readdirSync(dir).some((f) => f.replace(/^\d+_/, '') === name)
    })
    if (have) return // an earlier attempt, or the project's own
    const num = String(nextMigration++).padStart(5, '0')
    for (const d of ['sqlite', 'postgres']) {
      copyAndProcessFile(`gateway/internal/store/migrations/${d}/${file}`, `gateway/internal/store/migrations/${d}/${num}_${name}`)
    }
  }

  const copyDirOrFile = (relPath) => {
    const src = join(templateDir, relPath)
    if (!existsSync(src)) return
    const st = statSync(src)
    if (st.isDirectory()) {
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        copyDirOrFile(join(relPath, entry.name))
      }
    } else {
      copyAndProcessFile(relPath)
    }
  }

  if (moduleId === 'eventbus') {
    copyDirOrFile('gateway/internal/events')

    // Wire events into server.go if not present
    const srvPath = join(p.root, 'gateway/internal/server/server.go')
    if (existsSync(srvPath)) {
      let srvContent = readFileSync(srvPath, 'utf8')
      if (!srvContent.includes('Events *events.Bus')) {
        srvContent = srvContent.replace('type Server struct {', `type Server struct {\n\tEvents *events.Bus`)
        if (!srvContent.includes(`"${p.module}/internal/events"`)) {
          srvContent = srvContent.replace('import (', `import (\n\t"${p.module}/internal/events"`)
        }
        write(srvPath, srvContent)
        filesAdded.push('gateway/internal/server/server.go')
      }
    }

    // Wire events into main.go if not present
    const cmdDir = join(p.root, 'gateway/cmd')
    if (existsSync(cmdDir)) {
      const subdirs = readdirSync(cmdDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      for (const d of subdirs) {
        const mainPath = join(cmdDir, d.name, 'main.go')
        if (existsSync(mainPath)) {
          let mainContent = readFileSync(mainPath, 'utf8')
          if (!mainContent.includes('events.New()')) {
            mainContent = mainContent.replace(
              'srv, err := server.New(cfg, db)',
              'evBus := events.New()\n\tsrv, err := server.New(cfg, db)\n\tsrv.Events = evBus',
            )
            if (!mainContent.includes(`"${p.module}/internal/events"`)) {
              mainContent = mainContent.replace('import (', `import (\n\t"${p.module}/internal/events"`)
            }
            write(mainPath, mainContent)
            filesAdded.push(`gateway/cmd/${d.name}/main.go`)
          }
        }
      }
    }
  } else if (moduleId === 'audit') {
    copyDirOrFile('gateway/internal/audit')
    copyDirOrFile('gateway/internal/server/audit.go')
    copyDirOrFile('gateway/internal/store/queries/audit.sql')
    copyMigration('00003_audit.sql')
  } else if (moduleId === 's3') {
    copyDirOrFile('gateway/internal/objstore')
    copyDirOrFile('gateway/internal/server/files.go')
    copyDirOrFile('gateway/internal/store/queries/files.sql')
    copyMigration('00005_files.sql')
  } else if (moduleId === 'rbac') {
    upgradeRoles()
    copyDirOrFile('gateway/internal/server/rbac.go')
    copyDirOrFile('gateway/internal/store/queries/rbac.sql')
    copyMigration('00004_rbac.sql')
  } else if (moduleId === 'ws') {
    copyDirOrFile('gateway/internal/server/ws.go')
    copyDirOrFile('web/src/lib/live.ts')
  } else if (moduleId === 'sse') {
    copyDirOrFile('gateway/internal/server/sse.go')
    copyDirOrFile('web/src/lib/live.ts')
  } else if (moduleId === 'redis') {
    copyDirOrFile('gateway/internal/cache')
  } else if (moduleId === 'site') {
    copyDirOrFile('site')
  } else if (moduleId === 'ci') {
    copyDirOrFile('.github')
  }

  // The files every module touches (server.go routes, access.go, api.ts, App.tsx…) carry
  // `duck:if` blocks that the module turns on. Take the module's changes from the template
  // into the project's copy, which has its own resources in it: a three-way merge of
  // the template rendered without the module, as the project has it, and with the module.
  const conflicts = []
  const both = [] // merged keeping both sides: worth a look
  const own = new Set(filesAdded)
  const git = (args) => spawnSync('git', args, { encoding: 'utf8' })
  const scratch = mkdtempSync(join(tmpdir(), 'duck-module-'))
  const before = { ...cfg, [moduleId]: false }
  const walkTemplate = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return ['node_modules', 'dist', '.astro', '.dev'].includes(e.name) ? [] : walkTemplate(full)
    return [relative(templateDir, full)]
  })
  try {
    for (const rel of walkTemplate(templateDir)) {
      if (!TEXT_EXTS.test(rel) || own.has(rel) || rel.includes('store/migrations/') || rel.startsWith('site/') || rel.startsWith('.github/') || GENERATED.test(rel)) continue
      const raw = readFileSync(join(templateDir, rel), 'utf8')
      if (!/duck:(if|file)/.test(raw)) continue
      const was = processText(raw, before, defs, { file: rel })
      const now = processText(raw, cfg, defs, { file: rel })
      if (!now.keep) continue
      const next = substitute(now.text, n)
      const dest = join(p.root, rel)
      if (!was.keep) {
        // a file the module owns that the lists above do not copy (a page, say)
        if (!existsSync(dest)) {
          write(dest, next)
          filesAdded.push(rel)
        }
        continue
      }
      // the project's Go went through gofmt when it was generated; so must what it is merged with
      const fmt = (text) => {
        if (!rel.endsWith('.go')) return text
        const r = spawnSync('gofmt', [], { input: text, encoding: 'utf8' })
        return r.status === 0 ? r.stdout : text
      }
      const base = fmt(substitute(was.text, n))
      const theirs = fmt(next)
      if (base === theirs || !existsSync(dest)) continue
      const ours = readFileSync(dest, 'utf8')
      if (ours === theirs) continue
      const f = (name, text) => (writeFileSync(join(scratch, name), text, 'utf8'), join(scratch, name))
      // gofmt aligns the = of a const block to its longest name, so a line the project added
      // changes the spaces of its neighbours and none of them match the template's. Go is merged
      // with whitespace taken out, then formatted again.
      const isGo = rel.endsWith('.go')
      const canon = (text) => (isGo ? text.split('\n').map((l) => (l.trim().startsWith('//') ? l.trim() : l.trim().replace(/[ \t]+/g, ' '))).join('\n') : text)
      const files = [f('ours', canon(ours)), f('base', canon(base)), f('theirs', canon(theirs))]
      let r = git(['merge-file', '-p', ...files])
      if (r.error) {
        conflicts.push({ path: rel, reason: 'git is needed to merge the module into this file' })
        continue
      }
      if (r.status !== 0) {
        // both sides added lines at the same spot (a resource's permission next to the module's):
        // keep both. The checks after the module (go vet, tsc) catch what that gets wrong.
        r = git(['merge-file', '-p', '--union', ...files])
        if (r.status === 0) both.push(rel)
        else {
          conflicts.push({ path: rel, reason: 'the project changed the same lines: add the module\'s lines by hand (compare with the template)' })
          continue
        }
      }
      let merged = r.stdout
      if (isGo) {
        const g = spawnSync('gofmt', [], { input: merged, encoding: 'utf8' })
        if (g.status !== 0) {
          conflicts.push({ path: rel, reason: 'the merged Go does not parse: add the module\'s lines by hand (compare with the template)' })
          both.splice(both.indexOf(rel), 1)
          continue
        }
        merged = g.stdout
      }
      if (merged !== ours) {
        write(dest, merged)
        filesAdded.push(rel)
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  return {
    status: 'ok',
    alreadyActive: false,
    dryRun: dry,
    conflicts,
    mergedBoth: both,
    rollback: () => {
      for (const u of undo.reverse()) {
        if (u.prev === null) rmSync(u.path, { force: true })
        else writeFileSync(u.path, u.prev, 'utf8')
      }
    },
    module: moduleId,
    label: feat.label,
    filesAdded: [...new Set(filesAdded)],
    message: dry ? `Would activate module "${moduleId}": nothing written (--dry-run).` : `Activated module "${moduleId}" successfully.`,
  }
}

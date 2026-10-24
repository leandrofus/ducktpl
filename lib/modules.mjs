// modules.mjs: late opt-in activation of optional modules in existing projects.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

  // Derive project names
  const parts = p.module.split('/')
  const owner = parts.length > 1 ? parts[parts.length - 2] : 'owner'
  const name = parts[parts.length - 1] || 'app'
  const n = names(name, owner)

  const filesAdded = []

  const copyAndProcessFile = (relPath) => {
    const src = join(templateDir, relPath)
    const dest = join(p.root, relPath)
    if (!existsSync(src)) return

    mkdirSync(join(dest, '..'), { recursive: true })
    if (TEXT_EXTS.test(relPath)) {
      const raw = readFileSync(src, 'utf8')
      const proc = processText(raw, cfg, defs, { file: relPath })
      if (!proc.keep) return
      const finalContent = substitute(proc.text, n)
      writeFileSync(dest, finalContent, 'utf8')
    } else {
      cpSync(src, dest)
    }
    filesAdded.push(relPath)
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
        if (!srvContent.includes(`"${p.module}/gateway/internal/events"`)) {
          srvContent = srvContent.replace('import (', `import (\n\t"${p.module}/gateway/internal/events"`)
        }
        writeFileSync(srvPath, srvContent, 'utf8')
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
            if (!mainContent.includes(`"${p.module}/gateway/internal/events"`)) {
              mainContent = mainContent.replace('import (', `import (\n\t"${p.module}/gateway/internal/events"`)
            }
            writeFileSync(mainPath, mainContent, 'utf8')
            filesAdded.push(`gateway/cmd/${d.name}/main.go`)
          }
        }
      }
    }
  } else if (moduleId === 'audit') {
    copyDirOrFile('gateway/internal/audit')
    copyDirOrFile('gateway/internal/server/audit.go')
    copyDirOrFile('gateway/internal/store/queries/audit.sql')
    copyDirOrFile('gateway/internal/store/migrations/sqlite/00003_audit.sql')
    copyDirOrFile('gateway/internal/store/migrations/postgres/00003_audit.sql')
  } else if (moduleId === 's3') {
    copyDirOrFile('gateway/internal/objstore')
    copyDirOrFile('gateway/internal/server/files.go')
    copyDirOrFile('gateway/internal/store/queries/files.sql')
    copyDirOrFile('gateway/internal/store/migrations/sqlite/00005_files.sql')
    copyDirOrFile('gateway/internal/store/migrations/postgres/00005_files.sql')
  } else if (moduleId === 'rbac') {
    copyDirOrFile('gateway/internal/server/rbac.go')
    copyDirOrFile('gateway/internal/store/queries/rbac.sql')
    copyDirOrFile('gateway/internal/store/migrations/sqlite/00004_rbac.sql')
    copyDirOrFile('gateway/internal/store/migrations/postgres/00004_rbac.sql')
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

  return {
    status: 'ok',
    alreadyActive: false,
    module: moduleId,
    label: feat.label,
    filesAdded: [...new Set(filesAdded)],
    message: `Activated module "${moduleId}" successfully.`,
  }
}

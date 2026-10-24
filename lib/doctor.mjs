// doctor.mjs: health and sanity check for duck-template projects.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { smartInsert } from './ast.mjs'

export function checkProject(p, opts = {}) {
  const issues = []
  const passed = []

  // 1. Anchors Check
  const expectedAnchors = [
    { file: 'gateway/internal/server/server.go', anchor: '// ducktpl:routes' },
    { file: 'web/src/App.tsx', anchor: '// ducktpl:imports' },
    { file: 'web/src/App.tsx', anchor: '// ducktpl:nav' },
    { file: 'web/src/App.tsx', anchor: '// ducktpl:create' },
    { file: 'web/src/App.tsx', anchor: '// ducktpl:pages' },
    { file: 'web/src/lib/api.ts', anchor: '// ducktpl:types' },
  ]

  if (p.auth) {
    expectedAnchors.push(
      { file: 'gateway/internal/auth/perms.go', anchor: '// ducktpl:perms' },
      { file: 'gateway/internal/auth/perms.go', anchor: '// ducktpl:catalog' },
      { file: 'gateway/internal/auth/perms.go', anchor: '// ducktpl:user-perms' }
    )
  }

  if (p.rbac) {
    expectedAnchors.push({ file: 'gateway/internal/server/rbac.go', anchor: '// ducktpl:objects' })
  }

  if (p.live) {
    expectedAnchors.push({ file: 'web/src/lib/live.ts', anchor: '// ducktpl:live' })
  }

  for (const { file, anchor } of expectedAnchors) {
    const full = join(p.root, file)
    if (!existsSync(full)) {
      issues.push({ code: 'ERR_FILE_MISSING', message: `File "${file}" does not exist` })
      continue
    }
    const text = readFileSync(full, 'utf8')
    if (!text.includes(anchor)) {
      // Check if AST structural locator can handle insertion
      const rawAnchor = anchor.replace(/^(\/\/|#)\s*ducktpl:/, '').trim()
      let astValid = false
      try {
        smartInsert(text, rawAnchor, '', file)
        astValid = true
      } catch {
        astValid = false
      }

      if (astValid) {
        passed.push(`Structural AST target for "${rawAnchor}" valid in ${file} (comment anchor missing but AST fallback active)`)
      } else {
        issues.push({
          code: 'ERR_ANCHOR_MISSING',
          file,
          anchor,
          message: `Missing anchor "${anchor}" and AST boundary could not be resolved in ${file}`,
        })
      }
    } else {
      passed.push(`Anchor "${anchor}" in ${file}`)
    }
  }

  // 2. Migration Parity Check (SQLite vs Postgres)
  const sqliteDir = join(p.root, 'gateway/internal/store/migrations/sqlite')
  const pgDir = join(p.root, 'gateway/internal/store/migrations/postgres')

  if (existsSync(sqliteDir) && existsSync(pgDir)) {
    const sqliteFiles = readdirSync(sqliteDir).filter((f) => f.endsWith('.sql')).sort()
    const pgFiles = readdirSync(pgDir).filter((f) => f.endsWith('.sql')).sort()

    if (sqliteFiles.length !== pgFiles.length) {
      issues.push({
        code: 'ERR_MIGRATION_COUNT_MISMATCH',
        message: `Migration count mismatch: SQLite has ${sqliteFiles.length}, PostgreSQL has ${pgFiles.length}`,
      })
    } else {
      let mismatch = false
      for (let i = 0; i < sqliteFiles.length; i++) {
        if (sqliteFiles[i] !== pgFiles[i]) {
          issues.push({
            code: 'ERR_MIGRATION_NAME_MISMATCH',
            message: `Migration mismatch: "${sqliteFiles[i]}" vs "${pgFiles[i]}"`,
          })
          mismatch = true
          break
        }
      }
      if (!mismatch) {
        passed.push(`Migration parity (${sqliteFiles.length} migrations match in SQLite and Postgres)`)
      }
    }
  }

  // 3. Go Vet Check
  const gwDir = join(p.root, 'gateway')
  if (existsSync(join(gwDir, 'go.mod'))) {
    const r = spawnSync('go', ['vet', './...'], { cwd: gwDir, encoding: 'utf8' })
    if (r.status === 0) {
      passed.push('Go code compiles and passes go vet')
    } else {
      issues.push({
        code: 'ERR_GO_VET',
        message: `Go vet failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-5).join('; ')}`,
      })
    }
  }

  return {
    healthy: issues.length === 0,
    passed,
    issues,
  }
}

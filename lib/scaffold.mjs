import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { processText } from './markers.mjs'
import { defaults } from './features.mjs'

// Generated files are copied as they are: the post-install step regenerates
// them for the chosen modules.
const GENERATED = /^gateway\/internal\/store\/db\/|^gateway\/openapi\/openapi\.yaml$|^web\/src\/lib\/api-types\.ts$/

const TEXT = /\.(go|mod|sum|ts|tsx|mjs|js|json|css|html|md|ya?ml|sql|sh|txt|toml|astro|svg|service|socket|example)$|(^|\/)(Makefile|Dockerfile|_gitignore|\.gitkeep)$/

// Names the template is written with, and how each is derived.
export function names(name, owner) {
  const words = name.split(/[-_]/).filter(Boolean)
  return {
    module: `github.com/${owner}/${name}`,
    lower: name,
    display: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(''),
    upper: name.toUpperCase().replace(/-/g, '_'),
  }
}

export function substitute(text, n) {
  return text
    .replaceAll('github.com/duckowner/duckapp', n.module)
    .replaceAll('duckowner', n.module.split('/')[1])
    .replaceAll('DuckApp', n.display)
    .replaceAll('DUCKAPP', n.upper)
    .replaceAll('duckapp', n.lower)
}

// Build output and tool caches inside the template are never copied.
const SKIP_DIRS = new Set(['node_modules', '.astro', '.dev'])

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || (e.name === 'dist' && !p.endsWith(`ui${sep}dist`)) || p.endsWith(`gateway${sep}bin`)) continue
      yield* walk(p)
    } else yield p
  }
}

// Files that cannot carry markers (JSON) or are generated: kept or dropped
// by condition here.
const generatedFor = {
  'gateway/internal/store/db/users.sql.go': 'auth',
  'gateway/internal/store/db/audit.sql.go': 'audit',
  'gateway/internal/store/db/rbac.sql.go': 'rbac',
  'gateway/internal/store/db/files.sql.go': 's3',
}

/**
 * Copies the template into dest for cfg. Returns the list of written files.
 */
export function scaffold(templateDir, dest, cfg, n) {
  const defs = defaults()
  const written = []
  for (const src of walk(templateDir)) {
    let rel = relative(templateDir, src).split(sep).join('/')
    if (rel in generatedFor && !cfg[generatedFor[rel]]) continue
    if (rel.includes('/ui/dist/') && !rel.endsWith('/.gitkeep')) continue // a local UI build
    if (rel.startsWith('site/') && !cfg.site) continue
    if (rel.startsWith('.github/') && !cfg.ci) continue
    if ((rel.startsWith('deploy/systemd/duckapp-pam') || rel.endsWith('.pam')) && !cfg.pam) continue
    if (rel.endsWith('_gitignore')) rel = rel.replace(/_gitignore$/, '.gitignore')
    let out = substitute(rel, n)
    const target = join(dest, out)
    mkdirSync(dirname(target), { recursive: true })
    if (!TEXT.test(rel) || GENERATED.test(rel)) {
      if (GENERATED.test(rel) && TEXT.test(rel)) {
        writeFileSync(target, substitute(readFileSync(src, 'utf8'), n))
        written.push(out)
        continue
      }
      copyFileSync(src, target)
      written.push(out)
      continue
    }
    let text = readFileSync(src, 'utf8')
    const r = processText(text, cfg, defs, { file: rel })
    if (!r.keep) continue
    text = substitute(r.text, n)
    if (rel === 'web/package.json') text = webPackage(text, cfg, n)
    writeFileSync(target, text)
    if (statSync(src).mode & 0o111) chmodSync(target, 0o755)
    written.push(out)
  }
  return written
}

// The template's package.json is the React one. Preact swaps the runtime only:
// @preact/preset-vite aliases react and react-dom to preact/compat in the
// bundle, while TypeScript keeps checking against the React types, so the
// code is the same for both.
function webPackage(text, cfg, n) {
  const pkg = JSON.parse(text)
  pkg.name = `${n.lower}-web`
  if (cfg.preact) {
    for (const d of ['react', 'react-dom']) delete pkg.dependencies[d]
    delete pkg.devDependencies['@vitejs/plugin-react']
    pkg.dependencies.preact = '11.0.1'
    pkg.devDependencies['@preact/preset-vite'] = '2.10.6'
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

/** Validates every template file against the marker rules. */
export function check(templateDir) {
  const defs = defaults()
  let n = 0
  for (const src of walk(templateDir)) {
    const rel = relative(templateDir, src).split(sep).join('/')
    if (!TEXT.test(rel) || GENERATED.test(rel)) continue
    processText(readFileSync(src, 'utf8'), defs, defs, { file: rel, check: true })
    n++
  }
  return n
}

export function isEmptyDir(p) {
  return !existsSync(p) || readdirSync(p).length === 0
}

export function removeEmptyDirs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) removeEmptyDirs(join(dir, e.name))
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir)
}

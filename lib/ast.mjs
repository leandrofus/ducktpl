// ast.mjs: robust AST and structural syntax code injection for create-duck & ducktpl.
// Replaces fragile comment-anchor reliance with token-aware AST boundary detection.

const anchorRe = (anchor) => new RegExp(`^([ \\t]*)(//|#) ducktpl:${anchor}\\b.*$`, 'm')

/**
 * Finds the matching closing character (}, ), ]) respecting strings, comments, and nesting depth.
 */
export function findMatching(text, startIndex, openChar, closeChar) {
  let depth = 0
  let inString = null
  let inLineComment = false
  let inBlockComment = false

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (ch === '\\') {
        i++
      } else if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }

    if (ch === openChar) {
      depth++
    } else if (ch === closeChar) {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Injects Go routes into Handler() method without requiring // ducktpl:routes.
 */
export function insertRoutesAst(text, lines) {
  const handlerIdx = text.search(/func\s+(\([^)]+\)\s+)?Handler\s*\(/)
  if (handlerIdx === -1) {
    throw new Error('AST Error: could not locate Handler() method in server.go')
  }

  const openBrace = text.indexOf('{', handlerIdx)
  if (openBrace === -1) throw new Error('AST Error: Handler() has no body')

  const closeBrace = findMatching(text, openBrace, '{', '}')
  if (closeBrace === -1) throw new Error('AST Error: unbalanced braces in Handler()')

  const body = text.slice(openBrace + 1, closeBrace)

  // Preferred insertion point: right before 404 fallback or securityHeaders return
  const fallbackMatch = body.search(/(\n[ \t]*mux\.Handle\(\s*["']\/api\/["']|\n[ \t]*return\s+securityHeaders|\n[ \t]*return\s+mux)/)
  if (fallbackMatch !== -1) {
    const absIdx = openBrace + 1 + fallbackMatch + 1
    return text.slice(0, absIdx) + lines + text.slice(absIdx)
  }

  // Fallback: right before closing brace
  const lastLine = text.lastIndexOf('\n', closeBrace)
  const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBrace
  return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
}

/**
 * Injects Go permissions into const (...) block in auth/perms.go.
 */
export function insertPermsAst(text, lines) {
  const constIdx = text.search(/const\s*\(/)
  if (constIdx === -1) throw new Error('AST Error: could not locate const (...) block in perms.go')

  const openParen = text.indexOf('(', constIdx)
  const closeParen = findMatching(text, openParen, '(', ')')
  if (closeParen === -1) throw new Error('AST Error: unbalanced parentheses in perms.go const block')

  const lastLine = text.lastIndexOf('\n', closeParen)
  const insertIdx = lastLine !== -1 ? lastLine + 1 : closeParen
  return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
}

/**
 * Injects entries into Catalog slice in auth/perms.go.
 */
export function insertCatalogAst(text, lines) {
  const catIdx = text.search(/(var\s+Catalog\s*=\s*\[\]\s*any\s*\{|Catalog\s*=\s*\[\]\s*any\s*\{)/)
  if (catIdx === -1) throw new Error('AST Error: could not locate Catalog slice in perms.go')

  const openBrace = text.indexOf('{', catIdx)
  const closeBrace = findMatching(text, openBrace, '{', '}')
  if (closeBrace === -1) throw new Error('AST Error: unbalanced braces in Catalog slice')

  const lastLine = text.lastIndexOf('\n', closeBrace)
  const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBrace
  return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
}

/**
 * Injects entries into User default permissions slice in auth/perms.go.
 */
export function insertUserPermsAst(text, lines) {
  const userIdx = text.search(/(var\s+User\s*=\s*\[\]\s*any\s*\{|User\s*=\s*\[\]\s*any\s*\{)/)
  if (userIdx === -1) throw new Error('AST Error: could not locate User slice in perms.go')

  const openBrace = text.indexOf('{', userIdx)
  const closeBrace = findMatching(text, openBrace, '{', '}')
  if (closeBrace === -1) throw new Error('AST Error: unbalanced braces in User slice')

  const lastLine = text.lastIndexOf('\n', closeBrace)
  const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBrace
  return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
}

/**
 * Injects RBAC object permissions into rbac.go.
 */
export function insertRbacObjectsAst(text, lines) {
  const objIdx = text.search(/(var\s+Objects\s*=\s*map|Objects\s*=\s*map)/)
  if (objIdx === -1) throw new Error('AST Error: could not locate Objects map in rbac.go')

  const openBrace = text.indexOf('{', objIdx)
  const closeBrace = findMatching(text, openBrace, '{', '}')
  if (closeBrace === -1) throw new Error('AST Error: unbalanced braces in Objects map')

  const lastLine = text.lastIndexOf('\n', closeBrace)
  const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBrace
  return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
}

/**
 * Injects TypeScript imports right after the last top-level import statement.
 */
export function insertTsImportsAst(text, lines) {
  const importMatches = [...text.matchAll(/^import\s+[^;]+;?$/gm)]
  if (importMatches.length > 0) {
    const last = importMatches[importMatches.length - 1]
    const insertIdx = last.index + last[0].length + 1
    return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
  }
  return lines + '\n' + text
}

/**
 * Injects navigation items into const NAV: NavItem[] in App.tsx.
 */
export function insertTsNavAst(text, lines) {
  const navIdx = text.search(/const\s+NAV(\s*:\s*NavItem\[\])?\s*=\s*\[/)
  if (navIdx === -1) throw new Error('AST Error: could not locate const NAV array in App.tsx')

  const openBracket = text.indexOf('[', navIdx)
  const closeBracket = findMatching(text, openBracket, '[', ']')
  if (closeBracket === -1) throw new Error('AST Error: unbalanced brackets in NAV array')

  const lastLine = text.lastIndexOf('\n', closeBracket)
  const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBracket
  return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
}

/**
 * Injects page routing case into Shell switch in App.tsx.
 */
export function insertTsPagesAst(text, lines) {
  const switchIdx = text.search(/switch\s*\(\s*(route\.page|page|section)\s*\)/)
  if (switchIdx !== -1) {
    const openBrace = text.indexOf('{', switchIdx)
    const closeBrace = findMatching(text, openBrace, '{', '}')
    if (closeBrace !== -1) {
      const defaultIdx = text.indexOf('default:', openBrace)
      if (defaultIdx !== -1 && defaultIdx < closeBrace) {
        const lastLine = text.lastIndexOf('\n', defaultIdx)
        const insertIdx = lastLine !== -1 ? lastLine + 1 : defaultIdx
        return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
      }
      const lastLine = text.lastIndexOf('\n', closeBrace)
      const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBrace
      return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
    }
  }

  // Fallback: search before Shell() return
  const shellIdx = text.search(/function\s+Shell\s*\(/)
  if (shellIdx !== -1) {
    const openBrace = text.indexOf('{', shellIdx)
    const closeBrace = findMatching(text, openBrace, '{', '}')
    if (closeBrace !== -1) {
      const lastLine = text.lastIndexOf('\n', closeBrace)
      const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBrace
      return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
    }
  }
  return text.trimEnd() + '\n' + lines
}

/**
 * Injects type exports into api.ts.
 */
export function insertTsApiTypesAst(text, lines) {
  const typeMatches = [...text.matchAll(/^export\s+type\s+[^=]+=/gm)]
  if (typeMatches.length > 0) {
    const last = typeMatches[typeMatches.length - 1]
    const endOfLine = text.indexOf('\n', last.index)
    const insertIdx = endOfLine !== -1 ? endOfLine + 1 : text.length
    return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
  }
  return text.trimEnd() + '\n\n' + lines
}

/**
 * Injects paths into const PATHS in live.ts.
 */
export function insertTsLivePathsAst(text, lines) {
  const pathIdx = text.search(/const\s+PATHS(\s*:\s*Record<[^>]+>)?\s*=\s*\{/)
  if (pathIdx === -1) throw new Error('AST Error: could not locate const PATHS in live.ts')

  const openBrace = text.indexOf('{', pathIdx)
  const closeBrace = findMatching(text, openBrace, '{', '}')
  if (closeBrace === -1) throw new Error('AST Error: unbalanced braces in PATHS object')

  const lastLine = text.lastIndexOf('\n', closeBrace)
  const insertIdx = lastLine !== -1 ? lastLine + 1 : closeBrace
  return text.slice(0, insertIdx) + lines + text.slice(insertIdx)
}

/**
 * Master Smart Inserter:
 * 1. Checks if comment anchor (// ducktpl:<anchor>) is present. If so, uses it.
 * 2. If anchor is absent, gracefully switches to AST / structural boundary locator!
 */
export function smartInsert(text, anchor, lines, file) {
  const m = anchorRe(anchor).exec(text)
  if (m) {
    return text.slice(0, m.index) + lines + text.slice(m.index)
  }

  // Graceful AST Fallbacks
  switch (anchor) {
    case 'routes':
      return insertRoutesAst(text, lines)
    case 'perms':
      return insertPermsAst(text, lines)
    case 'catalog':
      return insertCatalogAst(text, lines)
    case 'user-perms':
      return insertUserPermsAst(text, lines)
    case 'objects':
      return insertRbacObjectsAst(text, lines)
    case 'imports':
      return insertTsImportsAst(text, lines)
    case 'nav':
      return insertTsNavAst(text, lines)
    case 'pages':
      return insertTsPagesAst(text, lines)
    case 'types':
      return insertTsApiTypesAst(text, lines)
    case 'live':
      return insertTsLivePathsAst(text, lines)
    default:
      if (anchor.startsWith('on-delete') || anchor.startsWith('on-deleted')) {
        // Safe append if on-delete anchor was deleted
        return text.trimEnd() + '\n' + lines
      }
      throw new Error(
        `${file}: anchor "ducktpl:${anchor}" not found and no AST fallback defined for "${anchor}".`
      )
  }
}

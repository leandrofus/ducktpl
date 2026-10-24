// handleredit.mjs: edits a generated resource handler (and its test) when a column
// is added to, removed from or retyped in its table. The pieces come from the
// generator itself (dtoType, fromReq, checks…), so the result is what `add` would
// have written had the column been there from the start.
import { checks, dtoType, fromReq, schema, setFromPatch, toDTO } from './generate.mjs'

// Index of the } that closes the { at open, counting nested braces (the literals
// hold sql.NullString{...} and the like).
function closeBrace(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return -1
}

// Edits the body (group 1) of the first match of re in place. Replacing the body
// text with String.replace would hit its first occurrence in the file, and a DTO
// struct repeats the lines of the request structs.
function editBody(text, re, edit) {
  const m = re.exec(text)
  if (!m) return text
  const start = m.index + m[0].indexOf('{') + 1
  return text.slice(0, start) + edit(m[1]) + text.slice(start + m[1].length)
}

// Appends "entry" to the first struct literal whose head matches (head ends in "{").
function addToLiteral(text, head, entry, key) {
  const m = head.exec(text)
  if (!m) return text
  const open = m.index + m[0].length - 1
  const close = closeBrace(text, open)
  if (close < 0 || text.slice(open, close).includes(key)) return text
  const body = text.slice(open + 1, close).trimEnd()
  return text.slice(0, open + 1) + body + (body.endsWith(',') ? ' ' : ', ') + entry + text.slice(close)
}

function ensureImport(text, pkg) {
  if (text.includes(`"${pkg}"`)) return text
  return text.replace(/import \(\n/, `import (\n\t"${pkg}"\n`)
}

// Drops the standard imports a handler no longer uses (a removed json, ref or
// required text column may have been the only user), or it does not compile.
function pruneImports(text) {
  const m = /import \(\n([\s\S]*?)\n\)\n/.exec(text)
  if (!m) return text
  const body = text.slice(m.index + m[0].length)
  const lines = m[1].split('\n').filter((l) => {
    const pkg = /^\s*"(encoding\/json|database\/sql|strings)"\s*$/.exec(l)?.[1]
    return !pkg || new RegExp(`\\b${pkg.split('/').pop()}\\.`).test(body)
  })
  return text.slice(0, m.index) + `import (\n${lines.join('\n')}\n)\n` + body
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The column x (a field from parseSingleField) added to a handler's code. */
export function addFieldToHandler(code, x) {
  let text = code
  if (text.includes(`json:"${x.name}"`)) return text

  // structs
  text = editBody(text, /type\s+\w+DTO\s+struct\s*\{([^}]+)\}/m, (body) =>
    body.replace(/([ \t]*)(CreatedAt\s+time\.Time)/, (_, _i, createdAt) => `\t${x.Go} ${dtoType(x)} \`json:"${x.name}"\`\n\t${createdAt}`))
  text = editBody(text, /type\s+create\w+Request\s+struct\s*\{([^}]+)\}/m, (body) => `${body.trimEnd()}\n\t${x.Go} ${dtoType(x)} \`json:"${x.name}"\`\n`)
  text = editBody(text, /type\s+update\w+Request\s+struct\s*\{([^}]+)\}/m, (body) => `${body.trimEnd()}\n\t${x.Go} opt[${x.t.go}] \`json:"${x.name}"\`\n`)

  // DTO mapper, and the db literals: a literal that omits the column still
  // compiles, and every PATCH would then reset it to its zero value
  text = text.replace(/(return\s+\w+DTO\{[^\n]*?)(,\s*CreatedAt:\s*x\.CreatedAt)/, (_, a, b) => `${a}, ${x.Go}: ${toDTO(x)}${b}`)
  text = addToLiteral(text, /v := db\.\w+\{/, `${x.Go}: ${fromReq(x)}`, `${x.Go}:`)
  text = addToLiteral(text, /db\.Create\w+Params\{/, `${x.Go}: v.${x.Go}`, `${x.Go}:`)
  text = addToLiteral(text, /db\.Update\w+Params\{/, `${x.Go}: v.${x.Go}`, `${x.Go}:`)
  text = text.replace(/^(\t*)(if err := check\w+\(r\.Context\(\), q, &v\); err != nil \{)/m, (_, ind, head) => `${setFromPatch(x)}\n${ind}${head}`)

  // contract: the DTO and both requests, never the Paginated list
  text = text.replace(/(\/\/ openapi:schema (\w+)\n(?:\/\/[^\n]*\n)*)/g, (block, _all, name) => {
    if (name.startsWith('Paginated')) return block
    let out = block.replace(/\n$/, '') + `\n//   ${x.name}: ${schema(x)}\n`
    if (/^Create/.test(name) && x.required) {
      out = /\/\/ required: \[/.test(out)
        ? out.replace(/(\/\/ required: \[[^\]]*)\]/, `$1, ${x.name}]`)
        : out.replace('// type: object\n', `// type: object\n// required: [${x.name}]\n`)
    } else if (!/^(Create|Update)/.test(name)) {
      out = out.replace(/(\/\/ required: \[[^\]]*?)(, created_at, updated_at\])/, `$1, ${x.name}$2`)
    }
    return out
  })

  // validation
  const cs = checks(x)
  if (cs.length) {
    text = text.replace(/(func check\w+\([^)]*\) error \{\n[\s\S]*?)(\treturn nil\n\})/, (_, head, tail) => head + cs.map((c) => c + '\n').join('') + tail)
    const body = cs.join('\n')
    if (/strings\./.test(body)) text = ensureImport(text, 'strings')
    if (/json\./.test(body)) text = ensureImport(text, 'encoding/json')
  }
  if (x.nullable) text = ensureImport(text, 'database/sql')
  return text
}

/** The column name removed from a handler's code. */
export function removeFieldFromHandler(code, name, Go) {
  let text = code
  // struct lines
  text = text.replace(new RegExp(`^[ \\t]*${Go}\\b[^\\n]*\`json:"${name}"\`[^\\n]*\\n?`, 'gm'), '')
  // entries in the mapper and in the db literals
  text = text.replace(new RegExp(`,?\\s*\\b${Go}:\\s*[^,{}]*(?:\\{[^{}]*\\}[^,{}]*)?(?=[,}])`, 'g'), '')
  // PATCH block
  text = text.replace(new RegExp(`^[ \\t]*if req\\.${Go}\\.Set \\{\\n[\\s\\S]*?\\n[ \\t]*\\}\\n`, 'gm'), '')
  // checks: one-tab if blocks that look at the field
  text = text.replace(new RegExp(`^\\tif [^\\n]*\\bv\\.${Go}\\b[^\\n]*\\{\\n(?:\\t\\t[^\\n]*\\n)*\\t\\}\\n`, 'gm'), '')
  // contract
  text = text.replace(new RegExp(`^//\\s+${name}:[^\\n]*\\n`, 'gm'), '')
  text = text.replace(/\/\/ required: \[([^\]]*)\]/g, (_, list) => {
    const kept = list.split(',').map((s) => s.trim()).filter((s) => s && s !== name)
    return `// required: [${kept.join(', ')}]`
  })
  return pruneImports(text.replace(/^\/\/ required: \[\]\n/gm, ''))
}

// ---- the resource's test ----

// Index just past the value that starts at i (a string, a call, an identifier…).
function valueEnd(text, i) {
  let depth = 0
  let quote = null
  for (; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === '`') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || (c === '}' && depth > 0)) depth--
    else if (depth === 0 && (c === ',' || c === '}')) return i
  }
  return i
}

/** Removes "key": value from the payload maps of a test file. */
export function removeKeyFromTest(text, key) {
  const needle = `"${key}":`
  let out = text
  for (let at = out.indexOf(needle); at >= 0; at = out.indexOf(needle)) {
    let end = valueEnd(out, at + needle.length)
    if (out[end] === ',') end++
    while (out[end] === ' ') end++
    out = out.slice(0, at) + out.slice(end)
  }
  return out.replace(/,\s*\}/g, '}')
}

/** Adds "key": sample to the maps that create the resource, so required columns pass. */
export function addKeyToTest(text, url, key, sample) {
  const create = new RegExp(`("POST", "${escRe(url)}", map\\[string\\]any\\{)(?!"nope")(?!\\})`, 'g')
  return text.replace(create, (_, head) => `${head}"${key}": ${sample}, `)
}

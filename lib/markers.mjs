// Feature markers. Template files carry blocks that the CLI keeps, drops or
// uncomments for the chosen features:
//
//   // duck:if auth            any comment syntax: //  #  --  <!-- -->
//   ...code...
//   // duck:else
//   // ...commented code...
//   // duck:end
//
//   // duck:file rbac          first marker of a file: keep the file only if true
//
// A condition is space-separated terms that must all hold; a term is
// alternatives joined by | (any may hold), each optionally negated with !.
// Example: `audit !auth`, `ws|sse redis`.
//
// The template itself is always valid code for the default configuration
// (every feature on, React): a block whose condition is false under the
// defaults is written commented out, one comment level, and the CLI
// uncomments it when the chosen features make it true. Blocks nest.

const MARKER = /^(\s*)(\/\/|#|--|<!--|\/\*)\s*duck:(if|else|end|file)\b\s*(.*?)\s*(?:-->|\*\/)?\s*$/

export function evaluate(cond, cfg) {
  const terms = cond.trim().split(/\s+/).filter(Boolean)
  if (!terms.length) throw new Error('empty duck:if condition')
  return terms.every((term) =>
    term.split('|').some((alt) => {
      const neg = alt.startsWith('!')
      const name = neg ? alt.slice(1) : alt
      if (!(name in cfg)) throw new Error(`unknown feature "${name}" in duck:if ${cond}`)
      return neg ? !cfg[name] : !!cfg[name]
    }),
  )
}

const frameTrue = (f, cfg) => (f.inElse ? !evaluate(f.cond, cfg) : evaluate(f.cond, cfg))

function uncomment(line, prefix) {
  const m = /^(\s*)(.*)$/.exec(line)
  let rest = m[2]
  if (prefix === '<!--') {
    rest = rest.replace(/^<!--\s?/, '').replace(/\s?-->$/, '')
  } else if (rest.startsWith(prefix + ' ')) {
    rest = rest.slice(prefix.length + 1)
  } else if (rest.startsWith(prefix)) {
    rest = rest.slice(prefix.length)
  }
  return m[1] + rest
}

function isCommented(line, prefix) {
  const t = line.trimStart()
  return prefix === '<!--' ? t.startsWith('<!--') && t.endsWith('-->') : t.startsWith(prefix)
}

/**
 * Processes one file. Returns { keep: false } when a duck:file condition
 * drops it, else { keep: true, text, changed }.
 * With check = true it only validates the template invariants and throws.
 */
export function processText(text, cfg, defaults, { file = '', check = false } = {}) {
  const lines = text.split('\n')
  const out = []
  const stack = []
  let fileCond = null
  let sawMarker = false
  const fail = (i, msg) => {
    throw new Error(`${file}:${i + 1}: ${msg}`)
  }
  lines.forEach((line, i) => {
    const m = MARKER.exec(line)
    if (m) {
      const [, , prefix, kind, cond] = m
      switch (kind) {
        case 'file':
          if (sawMarker || stack.length) fail(i, 'duck:file must be the first marker')
          fileCond = cond
          evaluate(cond, defaults)
          break
        case 'if':
          evaluate(cond, defaults)
          stack.push({ cond, prefix, inElse: false, line: i })
          break
        case 'else':
          if (!stack.length) fail(i, 'duck:else without duck:if')
          if (stack.at(-1).inElse) fail(i, 'second duck:else')
          stack.at(-1).inElse = true
          break
        case 'end':
          if (!stack.length) fail(i, 'duck:end without duck:if')
          stack.pop()
          break
      }
      sawMarker = true
      return
    }
    const inactive = stack.find((f) => !frameTrue(f, defaults))
    if (check) {
      if (inactive && line.trim() !== '' && !isCommented(line, inactive.prefix)) {
        fail(i, `inside a block that is off by default (duck:if ${inactive.cond}, line ${inactive.line + 1}) but not commented out`)
      }
      return
    }
    if (!stack.every((f) => frameTrue(f, cfg))) return
    out.push(inactive && line.trim() !== '' ? uncomment(line, inactive.prefix) : line)
  })
  if (stack.length) fail(stack.at(-1).line, `duck:if ${stack.at(-1).cond} is never closed`)
  if (check) return { keep: true, text }
  if (fileCond !== null && !evaluate(fileCond, cfg)) return { keep: false }
  // Removed blocks leave runs of blank lines behind.
  const collapsed = out.join('\n').replace(/\n{3,}/g, '\n\n')
  return { keep: true, text: collapsed, changed: sawMarker }
}

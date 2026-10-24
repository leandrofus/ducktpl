// resourcedef: edits the fields of web/src/resources/<table>.ts, the one place
// the UI learns what a resource looks like (see ui/resource/ in the template).
// Every function takes the file's text and returns the new text, or null when
// the file is not shaped like the generated one (the caller then says so).
import { fieldEntry, label } from './generate.mjs'

const entryRe = (name) => new RegExp(`^[ \\t]*\\{[^\\n]*\\bname:\\s*'${name}'[^\\n]*\\},?[ \\t]*$`, 'm')

/** The `fields: [ … ]` array: where its entries start and where it closes. */
function fieldsArray(text) {
  const open = /\bfields:\s*\[[ \t]*\n/.exec(text)
  if (!open) return null
  const from = open.index + open[0].length
  const close = /^[ \t]*\],?[ \t]*$/m.exec(text.slice(from))
  return close ? { from, to: from + close.index } : null
}

export function addField(text, field) {
  const a = fieldsArray(text)
  if (!a || entryRe(field.name).test(text.slice(a.from, a.to))) return null
  return text.slice(0, a.to) + fieldEntry(field) + '\n' + text.slice(a.to)
}

export function removeField(text, name) {
  const a = fieldsArray(text)
  if (!a) return null
  const body = text.slice(a.from, a.to)
  const m = entryRe(name).exec(body)
  if (!m) return null
  const end = a.from + m.index + m[0].length
  return text.slice(0, a.from + m.index) + text.slice(text[end] === '\n' ? end + 1 : end)
}

export function changeField(text, field) {
  const a = fieldsArray(text)
  if (!a) return null
  const m = entryRe(field.name).exec(text.slice(a.from, a.to))
  if (!m) return null
  const at = a.from + m.index
  return text.slice(0, at) + fieldEntry(field) + text.slice(at + m[0].length)
}

export function renameField(text, from, to) {
  const a = fieldsArray(text)
  if (!a) return null
  const m = entryRe(from).exec(text.slice(a.from, a.to))
  if (!m) return null
  let line = m[0].replace(`name: '${from}'`, `name: '${to}'`)
  // a label made from the old name follows it; one written by hand stays
  line = line.replace(`label: '${label(from)}'`, `label: '${label(to)}'`)
  const at = a.from + m.index
  let out = text.slice(0, at) + line + text.slice(at + m[0].length)
  out = out.replace(new RegExp(`(\\bscope:\\s*)'${from}'`), `$1'${to}'`)
  return out
}

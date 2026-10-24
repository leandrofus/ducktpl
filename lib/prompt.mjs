// prompt.mjs: interactive terminal prompts (checkbox multi-select, single select, text input)
// with zero external dependencies, using Node.js built-in readline and raw mode.
import readline from 'node:readline'

const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY)

const ESC = '\x1b'
const c = (code) => (s) => (isTTY ? `${ESC}[${code}m${s}${ESC}[0m` : s)
const bold = c(1), dim = c(2), green = c(32), cyan = c(36), yellow = c(33)

const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const CLEAR_LINE = `${ESC}[2K\r`
const CURSOR_UP = `${ESC}[A`

/**
 * Text input prompt.
 */
export async function textInput(message, { defaultValue = '' } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const hint = defaultValue ? dim(` [${defaultValue}]`) : ''
    const answer = await rl.question(`${cyan('?')} ${bold(message)}${hint}: `)
    const val = answer.trim()
    return val || defaultValue
  } finally {
    rl.close()
  }
}

/**
 * Single-select prompt (radio list with up/down navigation).
 *
 * @param {string} message
 * @param {Array<{id: string, label: string, hint?: string}>} items
 * @param {{defaultId?: string}} options
 * @returns {Promise<string>} chosen item id
 */
export async function select(message, items, { defaultId } = {}) {
  if (!isTTY) {
    return defaultId ?? items[0]?.id
  }

  let cursor = items.findIndex((it) => it.id === defaultId)
  if (cursor < 0) cursor = 0

  let linesRendered = 0

  const clear = () => {
    for (let i = 0; i < linesRendered; i++) {
      process.stdout.write(CLEAR_LINE + CURSOR_UP)
    }
    process.stdout.write(CLEAR_LINE)
    linesRendered = 0
  }

  const render = () => {
    clear()
    const out = []
    out.push(`${cyan('?')} ${bold(message)}`)
    linesRendered++

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const active = i === cursor
      const pointer = active ? cyan('❯ ') : '  '
      const radio = active ? cyan('◉ ') : dim('◯ ')
      const label = active ? bold(it.label) : it.label
      const hint = it.hint ? ` ${dim(`(${it.hint})`)}` : ''
      out.push(`${pointer}${radio}${label}${hint}`)
      linesRendered++
    }

    out.push(dim('  (Use ↑/↓ or j/k to navigate, enter to select)'))
    linesRendered++

    process.stdout.write(out.join('\n') + '\n')
  }

  process.stdout.write(HIDE_CURSOR)
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  render()

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('keypress', onKey)
      process.stdout.write(SHOW_CURSOR)
    }

    const onKey = (str, key) => {
      if (!key) return
      if (key.ctrl && key.name === 'c') {
        cleanup()
        process.stdout.write('\n')
        process.exit(130)
      }

      if (key.name === 'up' || str === 'k' || str === 'K') {
        cursor = (cursor - 1 + items.length) % items.length
        render()
      } else if (key.name === 'down' || str === 'j' || str === 'J') {
        cursor = (cursor + 1) % items.length
        render()
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup()
        clear()
        const chosen = items[cursor]
        console.log(`${green('✔')} ${bold(message)}: ${cyan(chosen.label)}`)
        resolve(chosen.id)
      }
    }

    process.stdin.on('keypress', onKey)
  })
}

/**
 * Multi-select prompt with checkboxes [ ] / [✓].
 *
 * @param {string} message
 * @param {Array<{id: string, label: string, hint?: string, requires?: string[]}>} items
 * @param {{selectedIds?: string[]}} options
 * @returns {Promise<string[]>} array of selected item ids
 */
export async function multiSelect(message, items, { selectedIds = [] } = {}) {
  if (!isTTY) {
    return selectedIds
  }

  const selected = new Set(selectedIds)
  let cursor = 0
  let linesRendered = 0

  const clear = () => {
    for (let i = 0; i < linesRendered; i++) {
      process.stdout.write(CLEAR_LINE + CURSOR_UP)
    }
    process.stdout.write(CLEAR_LINE)
    linesRendered = 0
  }

  // Auto-resolve requirements
  const toggleItem = (idx) => {
    const item = items[idx]
    if (selected.has(item.id)) {
      selected.delete(item.id)
      // If other selected items require this one, deselect them
      for (const other of items) {
        if (selected.has(other.id) && other.requires?.includes(item.id)) {
          selected.delete(other.id)
        }
      }
    } else {
      selected.add(item.id)
      // Auto-select requirements
      if (item.requires) {
        for (const req of item.requires) {
          selected.add(req)
        }
      }
    }
  }

  const render = () => {
    clear()
    const out = []
    const count = selected.size
    out.push(`${cyan('?')} ${bold(message)} ${dim(`(${count} selected)`)}`)
    linesRendered++

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const active = i === cursor
      const isChecked = selected.has(it.id)

      const pointer = active ? cyan('❯ ') : '  '
      const box = isChecked ? green('[✓] ') : dim('[ ] ')
      const label = active ? bold(it.label.padEnd(20)) : it.label.padEnd(20)
      const hint = it.hint ? ` ${dim(it.hint)}` : ''
      const req = it.requires && !isChecked ? ` ${yellow(dim(`(needs ${it.requires.join(', ')})`))}` : ''

      out.push(`${pointer}${box}${label}${hint}${req}`)
      linesRendered++
    }

    out.push(dim('  (↑/↓: navigate • space: toggle • a: select all • enter: confirm)'))
    linesRendered++

    process.stdout.write(out.join('\n') + '\n')
  }

  process.stdout.write(HIDE_CURSOR)
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  render()

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('keypress', onKey)
      process.stdout.write(SHOW_CURSOR)
    }

    const onKey = (str, key) => {
      if (!key) return
      if (key.ctrl && key.name === 'c') {
        cleanup()
        process.stdout.write('\n')
        process.exit(130)
      }

      if (key.name === 'up' || str === 'k' || str === 'K') {
        cursor = (cursor - 1 + items.length) % items.length
        render()
      } else if (key.name === 'down' || str === 'j' || str === 'J') {
        cursor = (cursor + 1) % items.length
        render()
      } else if (key.name === 'space' || str === ' ') {
        toggleItem(cursor)
        render()
      } else if (str === 'a' || str === 'A') {
        // Toggle all: if all selected, deselect all; else select all
        if (selected.size === items.length) {
          selected.clear()
        } else {
          for (const it of items) selected.add(it.id)
        }
        render()
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup()
        clear()
        const selectedList = items.filter((it) => selected.has(it.id)).map((it) => it.label)
        const summary = selectedList.length > 0 ? cyan(selectedList.join(', ')) : dim('none')
        console.log(`${green('✔')} ${bold(message)}: ${summary}`)
        resolve([...selected])
      }
    }

    process.stdin.on('keypress', onKey)
  })
}

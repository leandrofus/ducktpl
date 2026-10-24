import { t as tr } from '../i18n'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, MoreHorizontal } from 'lucide-react'
import { useMenu, useMenuAt } from './ContextMenu'
import type { MenuEntry } from './ContextMenu'
import { hue, stateLabel, stateTone } from '../lib/format'

export function Pill({ state, label, title }: { state: string; label?: string; title?: string }) {
  return (
    <span className={`pill pill-${stateTone(state)}`} title={title}>
      <i />
      {label ?? stateLabel[state] ?? state}
    </span>
  )
}

export function Tag({ children, tone, onContextMenu, onClick, title, mono }: { children: ReactNode; tone?: string; onContextMenu?: (e: any) => void; onClick?: () => void; title?: string; mono?: boolean }) {
  return (
    <span className={`tag${tone ? ' tag-' + tone : ''}${onClick ? ' clickable' : ''}${mono ? ' mono' : ''}`} onContextMenu={onContextMenu} onClick={onClick} title={title}>
      {children}
    </span>
  )
}

export function Avatar({ name, size = 28, src, square }: { name: string; size?: number; src?: string; square?: boolean }) {
  const [failed, setFailed] = useState(false)
  const h = hue(name)
  const initials = name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span
      className={`avatar${square ? ' square' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.4, ['--h' as any]: h }}
    >
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : initials || '?'}
    </span>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: ReactNode; count?: number; menu?: () => MenuEntry[] }[]; active: string; onChange: (id: string) => void }) {
  const menu = useMenu()
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          className={`tab${active === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
          onContextMenu={t.menu ? menu(t.menu) : undefined}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h4>{title}</h4>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  )
}

export function MenuButton({ items, label, className, title }: { items: () => MenuEntry[]; label?: ReactNode; className?: string; title?: string }) {
  const open = useMenuAt()
  return (
    <button
      className={className ?? 'icon-btn'}
      title={title ?? tr('More actions')}
      onClick={(e) => {
        e.stopPropagation()
        open(e.currentTarget, items())
      }}
    >
      {label ?? <MoreHorizontal size={16} />}
    </button>
  )
}

export function Props({ items }: { items: ([ReactNode, ReactNode, (() => MenuEntry[])?] | false | null | undefined | '' | 0)[] }) {
  const menu = useMenu()
  return (
    <dl className="props">
      {items.filter(Boolean).map((it, i) => {
        const [k, v, m] = it as [ReactNode, ReactNode, (() => MenuEntry[])?]
        return (
          <div key={i} className="prop" onContextMenu={m ? menu(m) : undefined}>
            <dt>{k}</dt>
            <dd>{v ?? <span className="muted">—</span>}</dd>
          </div>
        )
      })}
    </dl>
  )
}

export function Section({ title, children, actions, onContextMenu }: { title: ReactNode; children: ReactNode; actions?: ReactNode; onContextMenu?: (e: any) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="section" onContextMenu={onContextMenu}>
      <header onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <h4>{title}</h4>
        <span className="grow" />
        <span onClick={(e) => e.stopPropagation()}>{actions}</span>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

// ---------- data table ----------

export interface Column<T> {
  key: string
  label: ReactNode
  render: (row: T) => ReactNode
  sort?: (row: T) => string | number
  width?: number | string
  className?: string
}

export interface PaginationConfig {
  page: number
  perPage: number
  total: number
  onPageChange: (p: number) => void
  onPerPageChange?: (pp: number) => void
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onOpen,
  onPreview,
  rowMenu,
  bulkMenu,
  groupBy,
  groupHeader,
  groupMenu,
  selected,
  setSelected,
  empty,
  defaultSort,
  rowClass,
  pagination,
  renderChildRow,
  exportCsv,
  density,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (r: T) => string
  onOpen?: (r: T) => void
  onPreview?: (r: T) => void
  rowMenu?: (r: T) => MenuEntry[]
  bulkMenu?: (rows: T[]) => MenuEntry[]
  groupBy?: (r: T) => string
  groupHeader?: (group: string, rows: T[]) => ReactNode
  groupMenu?: (group: string, rows: T[]) => MenuEntry[]
  selected?: Set<string>
  setSelected?: (s: Set<string>) => void
  empty?: ReactNode
  defaultSort?: { key: string; dir: 1 | -1 }
  rowClass?: (r: T) => string
  pagination?: PaginationConfig
  renderChildRow?: (r: T) => ReactNode
  exportCsv?: boolean | string
  density?: 'compact' | 'comfortable'
}) {
  const menu = useMenu()
  const [sort, setSort] = useState(defaultSort ?? { key: '', dir: 1 as 1 | -1 })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expandedChild, setExpandedChild] = useState<Set<string>>(new Set())
  const lastClicked = useRef<string | null>(null)

  const toggleChild = (k: string) => {
    const next = new Set(expandedChild)
    next.has(k) ? next.delete(k) : next.add(k)
    setExpandedChild(next)
  }

  const downloadCsv = (filename: string, cols: Column<T>[], dataRows: T[]) => {
    const headers = cols.map((c) => (typeof c.label === 'string' ? c.label : c.key))
    const lines = [headers.join(',')]
    for (const r of dataRows) {
      const rowVals = cols.map((c) => {
        let val = c.sort ? c.sort(r) : ''
        if (val === undefined || val === null) val = ''
        const str = String(val).replace(/"/g, '""')
        return str.includes(',') || str.includes('\n') || str.includes('"') ? `"${str}"` : str
      })
      lines.push(rowVals.join(','))
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.perPage)) : 1
  const from = pagination ? (pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.perPage + 1) : 1
  const to = pagination ? Math.min(pagination.total, pagination.page * pagination.perPage) : rows.length

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const f = col.sort
    return [...rows].sort((a, b) => {
      const va = f(a)
      const vb = f(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [rows, sort, columns])

  const groups = useMemo(() => {
    if (!groupBy) return [['', sorted]] as [string, T[]][]
    const m = new Map<string, T[]>()
    for (const r of sorted) {
      const g = groupBy(r)
      if (!m.has(g)) m.set(g, [])
      m.get(g)!.push(r)
    }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [sorted, groupBy])

  const flat = groups.flatMap(([, rs]) => rs)
  const sel = selected ?? new Set<string>()
  const allSelected = flat.length > 0 && flat.every((r) => sel.has(rowKey(r)))

  const toggle = (r: T, shift: boolean) => {
    if (!setSelected) return
    const k = rowKey(r)
    const next = new Set(sel)
    if (shift && lastClicked.current) {
      const ids = flat.map(rowKey)
      const [a, b] = [ids.indexOf(lastClicked.current), ids.indexOf(k)].sort((x, y) => x - y)
      ids.slice(a, b + 1).forEach((id) => next.add(id))
    } else if (next.has(k)) next.delete(k)
    else next.add(k)
    lastClicked.current = k
    setSelected(next)
  }

  const onRowMenu = (r: T) => (e: React.MouseEvent) => {
    const k = rowKey(r)
    if (bulkMenu && sel.size > 1 && sel.has(k)) {
      menu(() => bulkMenu(flat.filter((x) => sel.has(rowKey(x)))), tr('{0} selected', sel.size))(e)
    } else if (rowMenu) {
      menu(() => rowMenu(r))(e)
    }
  }

  if (!rows.length && (!pagination || pagination.total === 0)) return <>{empty}</>

  return (
    <div className={`table-wrap${density === 'compact' ? ' table-compact' : ''}`}>
      <table className="table">
        <thead>
          <tr>
            {renderChildRow && <th className="col-expand" />}
            {setSelected && (
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && sel.size > 0
                  }}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(flat.map(rowKey)))}
                />
              </th>
            )}
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width }}
                className={`${c.sort ? 'sortable' : ''} ${c.className ?? ''}`}
                onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : 1 }))}
              >
                {c.label}
                {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([g, rs]) => (
            <GroupRows key={g || '_'}>
              {groupBy && (
                <tr
                  className={`group-row${collapsed.has(g) ? ' collapsed' : ''}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('input,a,.tag.clickable')) return
                    const n = new Set(collapsed)
                    n.has(g) ? n.delete(g) : n.add(g)
                    setCollapsed(n)
                  }}
                  onContextMenu={groupMenu ? menu(() => groupMenu(g, rs), g || undefined) : undefined}
                >
                  {renderChildRow && <td className="col-expand" />}
                  {setSelected && (
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={rs.every((r) => sel.has(rowKey(r)))}
                        ref={(el) => {
                          if (el) el.indeterminate = !rs.every((r) => sel.has(rowKey(r))) && rs.some((r) => sel.has(rowKey(r)))
                        }}
                        onChange={(e) => {
                          const n = new Set(sel)
                          rs.forEach((r) => (e.currentTarget.checked ? n.add(rowKey(r)) : n.delete(rowKey(r))))
                          setSelected(n)
                        }}
                      />
                    </td>
                  )}
                  <td colSpan={columns.length}>
                    <div className="group-head">
                      <span className="group-chevron">{collapsed.has(g) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
                      {groupHeader ? groupHeader(g, rs) : g}
                      <span className="muted small group-count">{rs.length}</span>
                    </div>
                  </td>
                </tr>
              )}
              {!collapsed.has(g) &&
                rs.map((r, ri) => {
                  const k = rowKey(r)
                  const tree = groupBy ? ` tree-child${ri === rs.length - 1 ? ' tree-last' : ''}` : ''
                  const isExpanded = expandedChild.has(k)
                  return (
                    <GroupRows key={k}>
                      <tr
                        className={`${sel.has(k) ? 'selected' : ''} ${rowClass?.(r) ?? ''}${tree}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button,a,input,.tag.clickable')) return
                          if (e.metaKey || e.ctrlKey || e.shiftKey) toggle(r, e.shiftKey)
                          else if (onPreview) onPreview(r)
                          else onOpen?.(r)
                        }}
                        onDoubleClick={() => onOpen?.(r)}
                        onContextMenu={onRowMenu(r)}
                      >
                        {renderChildRow && (
                          <td className="col-expand" onClick={(e) => { e.stopPropagation(); toggleChild(k) }}>
                            <button type="button" className="icon-btn xs" title={isExpanded ? 'Colapsar' : 'Expandir'}>
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                        )}
                        {setSelected && (
                          <td className="col-check" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={sel.has(k)} onChange={(e) => toggle(r, (e.nativeEvent as MouseEvent).shiftKey)} />
                          </td>
                        )}
                        {columns.map((c, ci) => (
                          <td key={c.key} className={`${c.className ?? ''}${groupBy && ci === 0 ? ' tree-cell' : ''}`}>
                            {c.render(r)}
                          </td>
                        ))}
                      </tr>
                      {renderChildRow && isExpanded && (
                        <tr className="child-row">
                          <td colSpan={columns.length + (setSelected ? 1 : 0) + 1} className="child-row-cell">
                            {renderChildRow(r)}
                          </td>
                        </tr>
                      )}
                    </GroupRows>
                  )
                })}
            </GroupRows>
          ))}
        </tbody>
      </table>
      {(pagination && pagination.total > 0) || exportCsv ? (
        <div className="table-foot">
          <div className="table-count">
            {pagination && pagination.total > 0 ? tr('Showing {0}–{1} of {2}', from, to, pagination.total) : `${flat.length} items`}
          </div>
          <span className="grow" />
          {exportCsv && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => downloadCsv(typeof exportCsv === 'string' ? exportCsv : 'export.csv', columns, flat)}
              title={tr('Export CSV')}
            >
              <Download size={13} /> CSV
            </button>
          )}
          {pagination && pagination.total > 0 && (
            <div className="table-pages">
              <button
                className="btn btn-sm"
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
              >
                {tr('Previous')}
              </button>
              <span className="page-num">
                {tr('Page {0} of {1}', pagination.page, totalPages)}
              </span>
              <button
                className="btn btn-sm"
                disabled={pagination.page >= totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
              >
                {tr('Next')}
              </button>
              {pagination.onPerPageChange && (
                <select
                  value={pagination.perPage}
                  onChange={(e) => pagination.onPerPageChange!(Number(e.target.value))}
                  className="per-page-select"
                >
                  <option value={10}>10 / {tr('page')}</option>
                  <option value={25}>25 / {tr('page')}</option>
                  <option value={50}>50 / {tr('page')}</option>
                  <option value={100}>100 / {tr('page')}</option>
                </select>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function GroupRows({ children }: { children: ReactNode }) {
  return <>{children}</>
}

// ---------- code editor (textarea with line numbers) ----------
export function CodeEditor({ value, onChange, minRows = 18, readOnly, placeholder }: { value: string; onChange?: (v: string) => void; minRows?: number; readOnly?: boolean; placeholder?: string }) {
  const lines = Math.max(value.split('\n').length, minRows)
  const gutter = useRef<HTMLDivElement>(null)
  return (
    <div className="code-editor">
      <div className="code-gutter" ref={gutter}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        spellCheck={false}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        rows={lines}
        onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        onChange={(e) => onChange?.(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && !readOnly) {
            e.preventDefault()
            const t = e.currentTarget
            const s = t.selectionStart
            const v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd)
            onChange?.(v)
            requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2))
          }
        }}
      />
    </div>
  )
}

export function Sparkline({ values, max, height = 36, tone = 'accent' }: { values: number[]; max?: number; height?: number; tone?: string }) {
  const w = 160
  const m = max ?? Math.max(1, ...values)
  if (values.length < 2) return <svg className={`spark spark-${tone}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" />
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / m) * (height - 2) - 1).toFixed(1)}`)
  return (
    <svg className={`spark spark-${tone}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <path d={`M0,${height} L${pts.join(' L')} L${w},${height} Z`} className="spark-fill" />
      <path d={`M${pts.join(' L')}`} className="spark-line" />
    </svg>
  )
}

export function Spinner() {
  return <span className="spinner" />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

// ---------- tabbed forms ----------
export interface FormTab {
  id: string
  label: ReactNode
  count?: number
  warn?: boolean
  content: ReactNode
}

/** Splits a long form into tabs; every tab stays mounted-on-demand. */
export function FormTabs({ tabs, active, onChange, aside }: { tabs: FormTab[]; active?: string; onChange?: (id: string) => void; aside?: ReactNode }) {
  const [own, setOwn] = useState(tabs[0]?.id)
  const cur = active ?? own
  const set = onChange ?? setOwn
  const tab = tabs.find((t) => t.id === cur) ?? tabs[0]
  return (
    <div className="form-tabs">
      <div className="form-tabs-bar">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`form-tab${t.id === tab?.id ? ' active' : ''}`} onClick={() => set(t.id)}>
            {t.label}
            {!!t.count && <span className="tab-count">{t.count}</span>}
            {t.warn && <span className="warn-dot" />}
          </button>
        ))}
        {aside && <span className="form-tabs-aside">{aside}</span>}
      </div>
      <div className="form-tabs-body">{tab?.content}</div>
    </div>
  )
}

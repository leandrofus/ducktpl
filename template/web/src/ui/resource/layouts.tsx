import type { CSSProperties } from 'react'
import { t } from '../../i18n'
import { api, enc } from '../../lib/api'
import { ago, dateTime } from '../../lib/format'
import { invalidate } from '../../lib/store'
import { Check } from 'lucide-react'
import { DataTable } from '../common'
import type { Column } from '../common'
import { useMenu } from '../ContextMenu'
import type { MenuEntry } from '../ContextMenu'
import { confirm, toast } from '../overlays'
import { CalendarView } from './Calendar'
import { RefName } from './refs'
import type { FieldDef, ResourceDef, Row } from './types'

// One component per layout. They share the same props: the rows to show and
// what to do with one. Pick the fields that stand for a row by their name.

export interface LayoutProps {
  def: ResourceDef
  rows: Row[]
  total: number
  page: number
  perPage: number
  setPage: (n: number) => void
  setPerPage: (n: number) => void
  open: (x: Row) => void
  menu: (x: Row) => MenuEntry[]
  create: (preset?: Partial<Row>) => void
}

const isText = (f: FieldDef) => f.type === 'string' || f.type === 'text'
const TITLES = ['title', 'name', 'display_name', 'username', 'subject', 'headline']
const IMAGES = ['avatar', 'photo', 'image', 'picture', 'url']

/** The fields that stand for a row in the layouts that do not show them all. */
export function summary(fields: FieldDef[]) {
  const title = fields.find((f) => isText(f) && TITLES.includes(f.name)) || fields.find(isText) || fields[0]
  const image = fields.find((f) => isText(f) && IMAGES.some((w) => f.name.includes(w)))
  const text = fields.find((f) => isText(f) && f !== title && f !== image) || fields.find((f) => f.type === 'text')
  return {
    title,
    image,
    text,
    tag: fields.find((f) => f.options?.length),
    ref: fields.find((f) => f.type === 'ref'),
  }
}

export function Cell({ f, x }: { f: FieldDef; x: Row }) {
  if (f.options?.length) return <span className="badge badge-subtle">{x[f.name]}</span>
  switch (f.type) {
    case 'bool': return x[f.name] ? <Check size={14} /> : null
    case 'text': return <span className="muted small ellipsis">{String(x[f.name]).split('\n')[0]}</span>
    case 'time': return <span className="small">{dateTime(x[f.name])}</span>
    case 'ref': return f.ref ? <span><RefName ref={f.ref} id={x[f.name]} /></span> : null
    default: return <span>{x[f.name]}</span>
  }
}

function sortKey(f: FieldDef, x: Row): string | number {
  if (f.type === 'bool') return x[f.name] ? 1 : 0
  return x[f.name] ?? ''
}

export function TableLayout({ def, rows, total, page, perPage, setPage, setPerPage, open, menu }: LayoutProps) {
  const columns: Column<Row>[] = [
    ...def.fields.slice(0, 4).map((f) => ({ key: f.name, label: t(f.label), sort: (x: Row) => sortKey(f, x), render: (x: Row) => <Cell f={f} x={x} /> })),
    { key: 'updated', label: t('Updated'), sort: (x) => x.updated_at ?? '', render: (x) => <span className="muted small" title={dateTime(x.updated_at)}>{ago(x.updated_at)}</span> },
  ]
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(x) => x.id}
      onOpen={open}
      rowMenu={menu}
      defaultSort={{ key: 'updated', dir: -1 }}
      pagination={{ page, perPage, total, onPageChange: setPage, onPerPageChange: setPerPage }}
    />
  )
}

export function CardsLayout({ def, rows, open, menu: actions }: LayoutProps) {
  const menu = useMenu()
  const { title, image, text, tag, ref } = summary(def.fields)
  return (
    <div className="cards">
      {rows.map((x) => (
        <div key={x.id} className="card" onClick={() => open(x)} onContextMenu={menu(() => actions(x))} style={{ cursor: 'pointer' }}>
          {image && x[image.name] && <img src={x[image.name]} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 'var(--radius)' }} />}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 650, fontSize: 16 }}>{x[title.name]}</span>
            {tag && x[tag.name] && <span className="pill pill-ok">{x[tag.name]}</span>}
          </div>
          {text && <p className="muted small" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x[text.name]}</p>}
          <div className="card-meta" style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted small">{ago(x.updated_at)}</span>
            {ref?.ref && <span className="tag mono"><RefName ref={ref.ref} id={x[ref.name]} /></span>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function FeedLayout({ def, rows, open, menu: actions }: LayoutProps) {
  const menu = useMenu()
  const { title, image, text, tag } = summary(def.fields)
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((x) => (
        <div key={x.id} className="card" onContextMenu={menu(() => actions(x))} style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                {(String(x[title.name])[0] || '?').toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{x[title.name]}</div>
                <div className="muted small">{ago(x.created_at)}</div>
              </div>
            </div>
            {tag && <span className="pill pill-ok">{x[tag.name]}</span>}
          </div>
          {text && <p style={{ margin: '8px 0 12px 0', lineHeight: 1.5 }}>{x[text.name]}</p>}
          {image && x[image.name] && <img src={x[image.name]} alt="" style={{ width: '100%', maxHeight: 320, objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: 12 }} />}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => open(x)}>{t('Edit')}</button>
            <button className="btn btn-sm btn-danger" onClick={() => removeRow(def, x)}>{t('Delete')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

const chat: Record<string, CSSProperties> = {
  frame: { maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' },
  log: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  bar: { padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--surface)' },
}

export function ChatLayout({ def, rows, menu: actions, create }: LayoutProps) {
  const menu = useMenu()
  const { title, text } = summary(def.fields)
  const send = (val: string) => api.post(def.url, { [title.name]: val }).then(() => invalidate(def.url), toast.err)
  return (
    <div style={chat.frame}>
      <div style={chat.log}>
        {rows.map((x, i) => {
          const me = i % 2 === 1
          return (
            <div key={x.id} onContextMenu={menu(() => actions(x))} style={{ display: 'flex', flexDirection: 'column', alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
              <div style={{ background: me ? 'var(--accent)' : 'var(--bg)', color: me ? '#fff' : 'inherit', padding: '10px 14px', borderRadius: 14, borderBottomRightRadius: me ? 2 : 14, borderBottomLeftRadius: !me ? 2 : 14, boxShadow: 'var(--shadow-sm)' }}>
                <p style={{ margin: 0, fontSize: 14, wordBreak: 'break-word' }}>{(text && x[text.name]) || x[title.name]}</p>
              </div>
              <span className="muted small" style={{ fontSize: 11, marginTop: 3, alignSelf: me ? 'flex-end' : 'flex-start' }}>{ago(x.created_at)}</span>
            </div>
          )
        })}
      </div>
      <div style={chat.bar}>
        <input
          placeholder={t('Type a message and press Enter…')}
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            const val = e.currentTarget.value.trim()
            if (e.key !== 'Enter' || !val) return
            e.currentTarget.value = ''
            send(val)
          }}
        />
        <button className="btn btn-primary btn-sm" onClick={() => create()}>{t('New')}</button>
      </div>
    </div>
  )
}

export function CalendarLayout({ def, rows, open, create }: LayoutProps) {
  const cal = def.calendar
  const { title } = summary(def.fields)
  if (!cal) return <div className="alert alert-bad">{t('{0} has no calendar fields', def.label)}</div>
  const at = (x: Row, f?: string) => (f && x[f] ? new Date(x[f]) : null)
  const shown = rows.filter((x) => at(x, cal.start))
  return (
    <CalendarView
      items={shown}
      start={(x) => at(x, cal.start)!}
      end={(x) => at(x, cal.end)}
      itemKey={(x) => x.id}
      render={(x) => <span>{x[title.name]}</span>}
      onOpen={open}
      onCreate={(d) => create({ [cal.start]: d.toISOString(), ...(cal.end ? { [cal.end]: new Date(+d + 3600000).toISOString() } : {}) })}
    />
  )
}

export async function removeRow(def: ResourceDef, x: Row, body = t('This cannot be undone.')) {
  if (!(await confirm({ title: t('Delete this {0}?', def.one), body, danger: true, confirm: t('Delete') }))) return
  api.del(`${def.url}/${enc(x.id)}`).then(() => invalidate(def.url), toast.err)
}

export const LAYOUTS = { table: TableLayout, cards: CardsLayout, feed: FeedLayout, chat: ChatLayout, calendar: CalendarLayout }

import { Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { t } from '../../i18n'
import type { Page } from '../../lib/api'
import { useList } from '../../lib/list'
import { usePref } from '../../lib/prefs'
import { useResource } from '../../lib/store'
import { Empty, Spinner } from '../common'
import type { MenuEntry } from '../ContextMenu'
import { openDialog } from '../overlays'
import { ResourceDialog } from './Dialog'
import { LAYOUTS, removeRow } from './layouts'
import { RefOptions } from './refs'
import type { ResourceDef, Row } from './types'

/**
 * The list page of a resource: header, search, scope picker, the layout the
 * definition asks for, and the dialog to create or edit. Props override the
 * pieces a page wants to do differently.
 */
export function ResourcePage({ def, icon, empty }: { def: ResourceDef; icon?: ReactNode; empty?: ReactNode }) {
  const scopeField = def.fields.find((f) => f.name === def.scope)
  const scopeRef = scopeField?.ref
  // the parent shown; '' is all of them (ducktpl addToScope)
  const [scope, setScope] = usePref(`scope:${scopeRef?.table ?? ''}`, '')
  const list = useList(`${def.url}:${def.layout}`, def.layout === 'table' ? 25 : 50)
  const { page, perPage, q, setPage, setPerPage, setQ } = list()
  const base = scopeRef && scope ? `${scopeRef.url}/${encodeURIComponent(scope)}${def.url}` : def.url
  // a calendar shows a span of time, not a page of rows
  const { data, error, loading } = useResource<Page<Row>>(def.layout === 'calendar' ? `${base}?all=1` : `${base}?page=${page}&per_page=${perPage}`)
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (data?.items || []).filter((x) => words.every((w) => JSON.stringify(x).toLowerCase().includes(w)))
  }, [data?.items, q])

  const create = (preset?: Partial<Row>) => openDialog((c) => <ResourceDialog def={def} scope={scope} preset={preset} onClose={c} />)
  const open = (x: Row) => openDialog((c) => <ResourceDialog def={def} row={x} onClose={c} />)
  const menu = (x: Row): MenuEntry[] => [
    { header: x[def.fields.find((f) => f.type === 'string' || f.type === 'text')?.name ?? 'id'] || x.id },
    { label: t('Edit…'), icon: <Pencil size={14} />, onClick: () => open(x) },
    ...(def.actions?.(x) ?? []),
    'sep',
    { label: t('Delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => removeRow(def, x, def.scope ? t('Everything in it is deleted too. This cannot be undone.') : undefined) },
  ]
  const Layout = LAYOUTS[def.layout] ?? LAYOUTS.table

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          {icon}
          <h1>{t(def.label)}</h1>
          <span className="count">{data?.total ?? 0}</span>
          {loading && <Spinner />}
        </div>
        <div className="page-actions">
          {scopeField?.ref && (
            <select value={scope} onChange={(e) => setScope(e.currentTarget.value)} title={t(scopeField.label)}>
              <option value="">{t('All {0}', scopeField.ref.label.toLowerCase())}</option>
              <RefOptions ref={scopeField.ref} />
            </select>
          )}
          <div className="search">
            <Search size={14} />
            <input placeholder={t('Search…')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            {q && <button className="icon-btn" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => create()}><Plus size={14} /> {t('New')}</button>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-bad">{error.message}</div>}
        {data && data.total === 0 ? (
          empty ?? <Empty icon={icon} title={t('Nothing here yet')} action={<button className="btn btn-primary" onClick={() => create()}><Plus size={14} /> {t('New')}</button>} />
        ) : (
          <Layout def={def} rows={rows} total={data?.total ?? 0} page={page} perPage={perPage} setPage={setPage} setPerPage={setPerPage} open={open} menu={menu} create={create} />
        )}
      </div>
    </div>
  )
}

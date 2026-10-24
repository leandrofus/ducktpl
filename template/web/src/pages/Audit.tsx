// duck:file audit
import { t } from '../i18n'
import { useState } from 'react'
import { ScrollText, ShieldCheck, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api'
import type { AuditEvent, Page } from '../lib/api'
import { useResource } from '../lib/store'
import { ago, dateTime } from '../lib/format'
import { DataTable, Spinner, Tag } from '../ui/common'
import { toast } from '../ui/overlays'

type Verification = { events: number; valid: boolean; error?: string }

export function Audit() {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const { data, error, loading } = useResource<Page<AuditEvent>>(`/audit?page=${page}&per_page=${perPage}`)
  const [check, setCheck] = useState<Verification | null>(null)
  const [busy, setBusy] = useState(false)
  const verify = () => {
    setBusy(true)
    api.get<Verification>('/audit/verify').then(setCheck, toast.err).finally(() => setBusy(false))
  }
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <ScrollText size={20} />
          <h1>{t('Audit log')}</h1>
          <span className="count">{data?.total ?? 0}</span>
          {loading && <Spinner />}
        </div>
        <div className="page-actions">
          {check && (check.valid
            ? <Tag tone="ok"><ShieldCheck size={12} /> {t('chain intact ({0} events)', check.events)}</Tag>
            : <Tag tone="bad"><ShieldAlert size={12} /> {check.error}</Tag>)}
          <button className="btn btn-sm" disabled={busy} onClick={verify}>{busy ? <Spinner /> : <ShieldCheck size={14} />} {t('Verify chain')}</button>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-bad">{error.message}</div>}
        <DataTable
          rows={data?.items || []}
          rowKey={(e) => String(e.seq)}
          pagination={{
            page,
            perPage,
            total: data?.total ?? 0,
            onPageChange: setPage,
            onPerPageChange: (pp) => { setPerPage(pp); setPage(1) },
          }}
          columns={[
            { key: 'seq', label: '#', width: 60, render: (e) => <span className="mono small muted">{e.seq}</span> },
            { key: 'when', label: t('When'), render: (e) => <span className="small" title={dateTime(e.created_at)}>{ago(e.created_at)}</span> },
            { key: 'who', label: t('Who'), render: (e) => <span>{e.actor_username || <span className="muted">—</span>} <span className="muted small mono">{e.actor_ip}</span></span> },
            { key: 'action', label: t('Action'), render: (e) => <Tag mono>{e.action}</Tag> },
            { key: 'target', label: t('Target'), render: (e) => <span className="mono small">{e.target_type}{e.target_id && ':' + e.target_id.slice(0, 8)}</span> },
            { key: 'details', label: t('Details'), render: (e) => <span className="mono small muted ellipsis">{JSON.stringify(e.details) === '{}' ? '' : JSON.stringify(e.details)}</span> },
          ]}
        />
      </div>
    </div>
  )
}

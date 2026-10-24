import { t } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { StickyNote, Plus, Search, X, Pin, PinOff, Trash2, Pencil } from 'lucide-react'
// duck:if s3
import { Paperclip, Download, Upload } from 'lucide-react'
// duck:end
// duck:if rbac
import { Share2 } from 'lucide-react'
// duck:end
import { api, enc } from '../lib/api'
import type { Note, Page } from '../lib/api'
// duck:if s3
import { upload } from '../lib/api'
import type { FileInfo } from '../lib/api'
import { bytes } from '../lib/format'
// duck:end
// duck:if rbac
import { Sharing } from './Sharing'
// duck:end
import { invalidate, useResource } from '../lib/store'
import { go } from '../lib/router'
import { ago, dateTime } from '../lib/format'
import type { MenuEntry } from '../ui/ContextMenu'
import { DataTable, Empty, MenuButton, Props, Section, Spinner, Tag } from '../ui/common'
import { Drawer, Modal, confirm, openDialog, toast } from '../ui/overlays'
import { Field } from '../ui/Field'

// Notes are the example resource: a list page, a drawer to read and edit
// one, and a dialog to create. Copy the shape for your own resources.

function noteActions(n: Note): MenuEntry[] {
  return [
    { header: n.title },
    { label: t('Open'), onClick: () => go('notes', n.id) },
    { label: t('Edit…'), icon: <Pencil size={14} />, onClick: () => openDialog((c) => <NoteFormDialog initial={n} onClose={c} />) },
    { label: n.pinned ? t('Unpin') : t('Pin'), icon: n.pinned ? <PinOff size={14} /> : <Pin size={14} />, onClick: () => save(n.id, { pinned: !n.pinned }) },
    // duck:if rbac
    { label: t('Share…'), icon: <Share2 size={14} />, onClick: () => openDialog((c) => <Modal title={t('Share {0}', n.title)} onClose={c}><Sharing objectType="note" objectId={n.id} /></Modal>) },
    // duck:end
    'sep',
    { label: t('Delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => remove(n) },
  ]
}

function save(id: string, patch: Partial<Note>) {
  return api.patch<Note>(`/notes/${enc(id)}`, patch).then(() => invalidate('/notes'), toast.err)
}

async function remove(n: Note) {
  if (!(await confirm({ title: t('Delete {0}?', n.title), body: t('This cannot be undone.'), danger: true, confirm: t('Delete') }))) return
  api.del(`/notes/${enc(n.id)}`).then(() => (invalidate('/notes'), go('notes')), toast.err)
}

export function Notes({ id }: { id?: string }) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const { data, error, loading } = useResource<Page<Note>>(`/notes?page=${page}&per_page=${perPage}`)
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (data?.items || []).filter((n) => words.every((w) => `${n.title} ${n.body}`.toLowerCase().includes(w)))
  }, [data?.items, q])
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <StickyNote size={20} />
          <h1>{t('Notes')}</h1>
          <span className="count">{data?.total ?? 0}</span>
          {loading && <Spinner />}
        </div>
        <div className="page-actions">
          <div className="search">
            <Search size={14} />
            <input placeholder={t('Search notes…')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            {q && <button className="icon-btn" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => openDialog((c) => <NoteFormDialog onClose={c} />)}>
            <Plus size={14} /> {t('Note')}
          </button>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-bad">{error.message}</div>}
        {data && data.total === 0 ? (
          <Empty icon={<StickyNote size={28} />} title={t('No notes yet')} action={<button className="btn btn-primary" onClick={() => openDialog((c) => <NoteFormDialog onClose={c} />)}><Plus size={14} /> {t('Write the first one')}</button>}>
            {t('Notes are the example resource of this template: table, queries, handlers and this page.')}
          </Empty>
        ) : (
          <DataTable
            rows={rows}
            rowKey={(n) => n.id}
            onOpen={(n) => go('notes', n.id)}
            rowMenu={noteActions}
            defaultSort={{ key: 'updated', dir: -1 }}
            pagination={{
              page,
              perPage,
              total: data?.total ?? 0,
              onPageChange: setPage,
              onPerPageChange: (pp) => { setPerPage(pp); setPage(1) },
            }}
            columns={[
              { key: 'title', label: t('Title'), sort: (n) => n.title.toLowerCase(), render: (n) => <strong>{n.title}</strong> },
              { key: 'pinned', label: '', width: 40, sort: (n) => (n.pinned ? 1 : 0), render: (n) => (n.pinned ? <Pin size={13} className="muted" /> : null) },
              { key: 'body', label: t('Text'), render: (n) => <span className="muted small ellipsis">{n.body.split('\n')[0]}</span> },
              { key: 'updated', label: t('Updated'), sort: (n) => n.updated_at, render: (n) => <span className="muted small" title={dateTime(n.updated_at)}>{ago(n.updated_at)}</span> },
            ]}
          />
        )}
      </div>
      {id && <NoteDrawer id={id} onClose={() => go('notes')} />}
    </div>
  )
}

function NoteDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: n, error } = useResource<Note>(`/notes/${enc(id)}`)
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => setBody(null), [id])
  const dirty = n && body !== null && body !== n.body
  return (
    <Drawer onClose={onClose} width={640}>
      {error && <div className="alert alert-bad">{error.message}</div>}
      {!n ? (
        !error && <Spinner />
      ) : (
        <div className="drawer-body">
          <header className="record-head">
            <div className="record-title">
              <h1>{n.title}</h1>
              <div className="row gap wrap">
                {n.pinned && <Tag tone="warn"><Pin size={11} /> {t('pinned')}</Tag>}
                <span className="muted small">{t('updated {0}', ago(n.updated_at))}</span>
              </div>
            </div>
            <div className="record-actions"><MenuButton items={() => noteActions(n)} className="btn btn-sm" /></div>
          </header>
          <textarea className="note-body" value={body ?? n.body} placeholder={t('Write something…')} onChange={(e) => setBody(e.currentTarget.value)} />
          <div className="row gap">
            <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => save(n.id, { body: body! }).then(() => setBody(null))}>{t('Save')}</button>
            {dirty && <button className="btn btn-sm" onClick={() => setBody(null)}>{t('Discard')}</button>}
          </div>
          {/* Optional modules add sections here: files (s3), sharing (rbac). */}
          {NoteExtras.map((X, i) => <X key={i} note={n} />)}
          <Section title={t('Properties')}>
            <Props items={[
              [t('Created'), <span title={dateTime(n.created_at)}>{ago(n.created_at)}</span>],
              [t('Id'), <span className="mono small">{n.id}</span>],
            ]} />
          </Section>
        </div>
      )}
    </Drawer>
  )
}

// duck:if s3
function NoteFiles({ note }: { note: Note }) {
  const { data } = useResource<FileInfo[]>(`/notes/${enc(note.id)}/files`)
  const [busy, setBusy] = useState(false)
  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => {
      setBusy(true)
      try {
        for (const f of Array.from(input.files || [])) await upload(`/notes/${enc(note.id)}/files`, f)
        invalidate(`/notes/${enc(note.id)}/files`)
      } catch (e) {
        toast.err(e)
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }
  return (
    <Section title={t('Files')} actions={<button className="btn btn-sm" disabled={busy} onClick={pick}>{busy ? <Spinner /> : <Upload size={13} />} {t('Attach')}</button>}>
      {data?.length ? (
        <div className="rel-list">
          {data.map((f) => (
            <div key={f.id} className="rel-item">
              <Paperclip size={13} />
              <span className="grow ellipsis">{f.name}</span>
              <span className="muted small">{bytes(f.size)}</span>
              <a className="icon-btn" href={`/api/v1/files/${enc(f.id)}/content`} title={t('Download')}><Download size={14} /></a>
              <button className="icon-btn" title={t('Delete')} onClick={() => api.del(`/files/${enc(f.id)}`).then(() => invalidate(`/notes/${enc(note.id)}/files`), toast.err)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      ) : (
        <span className="muted">{t('No files.')}</span>
      )}
    </Section>
  )
}
// duck:end

// duck:if rbac
function NoteSharing({ note }: { note: Note }) {
  return (
    <Section title={t('Sharing')}>
      <Sharing objectType="note" objectId={note.id} />
    </Section>
  )
}
// duck:end

const NoteExtras: ((p: { note: Note }) => ReactNode)[] = [
  // duck:if s3
  NoteFiles,
  // duck:end
  // duck:if rbac
  NoteSharing,
  // duck:end
]

export function NoteFormDialog({ initial, onClose }: { initial?: Note; onClose: () => void }) {
  const [v, setV] = useState({ title: initial?.title ?? '', body: initial?.body ?? '', pinned: initial?.pinned ?? false })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      if (initial) {
        await api.patch(`/notes/${enc(initial.id)}`, v)
      } else {
        const n = await api.post<Note>('/notes', v)
        go('notes', n.id)
      }
      invalidate('/notes')
      onClose()
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? t('Edit note') : t('New note')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !v.title.trim()} onClick={submit}>{initial ? t('Save') : t('Create')}</button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Field label={t('Title')}>
          <input autoFocus value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.currentTarget.value })} />
        </Field>
        <Field label={t('Text')}>
          <textarea rows={6} value={v.body} onChange={(e) => setV({ ...v, body: e.currentTarget.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={v.pinned} onChange={(e) => setV({ ...v, pinned: e.currentTarget.checked })} /> {t('Pin to the top')}
        </label>
      </form>
    </Modal>
  )
}

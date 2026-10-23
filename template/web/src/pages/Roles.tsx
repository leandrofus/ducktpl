// duck:file rbac
import { t } from '../i18n'
import { useState } from 'react'
import { ShieldCheck, Plus, Pencil, Trash2 } from 'lucide-react'
import { api, enc } from '../lib/api'
import type { Permission, Role } from '../lib/api'
import { invalidate, useResource } from '../lib/store'
import type { MenuEntry } from '../ui/ContextMenu'
import { DataTable, Spinner, Tag } from '../ui/common'
import { Modal, confirm, openDialog, toast } from '../ui/overlays'
import { Field } from '../ui/Field'

// Roles hold global permissions. Per-object access is given with grants
// (the Share action on a note).

function roleActions(r: Role): MenuEntry[] {
  return [
    { header: r.name },
    { label: t('Edit…'), icon: <Pencil size={14} />, onClick: () => openDialog((c) => <RoleDialog initial={r} onClose={c} />) },
    'sep',
    {
      label: t('Delete'), icon: <Trash2 size={14} />, danger: true, disabled: r.builtin, onClick: async () => {
        if (!(await confirm({ title: t('Delete the role {0}?', r.name), danger: true, confirm: t('Delete') }))) return
        api.del(`/roles/${enc(r.name)}`).then(() => invalidate('/roles'), toast.err)
      },
    },
  ]
}

export function Roles() {
  const { data, error, loading } = useResource<Role[]>('/roles')
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <ShieldCheck size={20} />
          <h1>{t('Roles')}</h1>
          <span className="count">{data?.length ?? 0}</span>
          {loading && <Spinner />}
        </div>
        <div className="page-actions">
          <button className="btn btn-primary btn-sm" onClick={() => openDialog((c) => <RoleDialog onClose={c} />)}><Plus size={14} /> {t('Role')}</button>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-bad">{error.message}</div>}
        <DataTable
          rows={data || []}
          rowKey={(r) => r.name}
          onOpen={(r) => openDialog((c) => <RoleDialog initial={r} onClose={c} />)}
          rowMenu={roleActions}
          columns={[
            { key: 'name', label: t('Name'), sort: (r) => r.name, render: (r) => <span className="row gap"><strong>{r.name}</strong>{r.builtin && <Tag>{t('builtin')}</Tag>}</span> },
            { key: 'desc', label: t('Description'), render: (r) => <span className="muted small">{r.description}</span> },
            { key: 'perms', label: t('Permissions'), render: (r) => <span className="tags">{r.permissions.map((p) => <Tag key={p} mono>{p === '*' ? t('everything') : p}</Tag>)}</span> },
          ]}
        />
      </div>
    </div>
  )
}

function RoleDialog({ initial, onClose }: { initial?: Role; onClose: () => void }) {
  const { data: catalog } = useResource<Permission[]>('/permissions')
  const [v, setV] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', permissions: initial?.permissions ?? [] })
  const all = v.permissions.includes('*')
  const toggle = (p: string) => setV({ ...v, permissions: v.permissions.includes(p) ? v.permissions.filter((x) => x !== p) : [...v.permissions, p] })
  const save = async () => {
    try {
      if (initial) await api.patch(`/roles/${enc(initial.name)}`, initial.name === 'admin' ? { description: v.description } : { description: v.description, permissions: v.permissions })
      else await api.post('/roles', v)
      invalidate('/roles')
      onClose()
    } catch (e) {
      toast.err(e)
    }
  }
  return (
    <Modal
      title={initial ? t('Role {0}', initial.name) : t('New role')}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn btn-primary" disabled={!v.name} onClick={save}>{initial ? t('Save') : t('Create')}</button>
      </>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())}>
        {!initial && (
          <Field label={t('Name')}>
            <input autoFocus className="mono" value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value.toLowerCase() })} />
          </Field>
        )}
        <Field label={t('Description')}>
          <input value={v.description} onChange={(e) => setV({ ...v, description: e.currentTarget.value })} />
        </Field>
        <div className="field">
          <span>{t('Permissions')}</span>
          {all ? (
            <span className="muted">{t('This role holds every permission.')}</span>
          ) : (
            (catalog || []).map((p) => (
              <label key={p.name} className="check">
                <input type="checkbox" checked={v.permissions.includes(p.name)} onChange={() => toggle(p.name)} />
                <span className="mono small">{p.name}</span> <span className="muted small">{p.description}</span>
              </label>
            ))
          )}
        </div>
      </form>
    </Modal>
  )
}

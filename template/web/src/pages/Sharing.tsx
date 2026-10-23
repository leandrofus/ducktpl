// duck:file rbac
import { t } from '../i18n'
import { useState } from 'react'
import { Trash2, UserRound, ShieldCheck } from 'lucide-react'
import { api, enc } from '../lib/api'
import type { Grant, Role, User } from '../lib/api'
import { invalidate, useResource } from '../lib/store'
import { can } from '../lib/session'
import { Tag } from '../ui/common'
import { toast } from '../ui/overlays'

// Grants on one object: who (a user, or everyone holding a role) may do
// what on it, beyond their role's global permissions.

const PERMS: Record<string, { id: string; label: string }[]> = {
  note: [
    { id: 'notes.read', label: t('can read') },
    { id: 'notes.write', label: t('can edit') },
  ],
}

export function Sharing({ objectType, objectId }: { objectType: string; objectId: string }) {
  const key = `/grants?object_type=${enc(objectType)}&object_id=${enc(objectId)}`
  const { data, error } = useResource<Grant[]>(key)
  // Listing users needs users.manage; without it, share with roles only.
  const { data: users } = useResource<User[]>(can('users.manage') ? '/users' : null)
  const { data: roles } = useResource<Role[]>('/roles')
  const perms = PERMS[objectType] ?? []
  const [v, setV] = useState({ subject: '', permission: perms[0]?.id ?? '' })
  const name = (g: Grant) => (g.subject_type === 'user' ? users?.find((u) => u.id === g.subject_id)?.username ?? g.subject_id : g.subject_id)
  const add = () => {
    const [subject_type, subject_id] = v.subject.split(':')
    api.post('/grants', { subject_type, subject_id, object_type: objectType, object_id: objectId, permission: v.permission }).then(() => invalidate('/grants'), toast.err)
  }
  if (error) return <div className="alert alert-bad">{error.message}</div>
  return (
    <div className="form">
      {data?.length ? (
        <div className="rel-list">
          {data.map((g) => (
            <div key={g.id} className="rel-item">
              {g.subject_type === 'user' ? <UserRound size={13} /> : <ShieldCheck size={13} />}
              <strong>{name(g)}</strong>
              {g.subject_type === 'role' && <span className="muted small">{t('(role)')}</span>}
              <span className="grow" />
              <Tag mono>{perms.find((p) => p.id === g.permission)?.label ?? g.permission}</Tag>
              <button className="icon-btn" title={t('Revoke')} onClick={() => api.del(`/grants/${enc(g.id)}`).then(() => invalidate(key), toast.err)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      ) : (
        <span className="muted">{t('Only what roles grant globally.')}</span>
      )}
      <div className="row gap">
        <select value={v.subject} onChange={(e) => setV({ ...v, subject: e.currentTarget.value })}>
          <option value="">{t('Share with…')}</option>
          {(users || []).map((u) => <option key={u.id} value={`user:${u.id}`}>{u.username}</option>)}
          {(roles || []).filter((r) => r.name !== 'admin').map((r) => <option key={r.name} value={`role:${r.name}`}>{t('everyone with role {0}', r.name)}</option>)}
        </select>
        <select value={v.permission} onChange={(e) => setV({ ...v, permission: e.currentTarget.value })}>
          {perms.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button className="btn btn-sm" disabled={!v.subject} onClick={add}>{t('Share')}</button>
      </div>
    </div>
  )
}

// duck:file auth
import { t } from '../i18n'
import { useMemo, useState } from 'react'
import { Users as UsersIcon, Plus, Search, X, Pencil, KeyRound, Ban, CheckCircle2, Trash2 } from 'lucide-react'
import { api, enc } from '../lib/api'
import type { Page, User } from '../lib/api'
// duck:if rbac
import type { Role } from '../lib/api'
// duck:end
import { invalidate, useResource } from '../lib/store'
import { go } from '../lib/router'
import { ago, dateTime } from '../lib/format'
import { getMe } from '../lib/session'
import type { MenuEntry } from '../ui/ContextMenu'
import { Avatar, DataTable, MenuButton, Pill, Props, Section, Spinner, Tag } from '../ui/common'
import { Drawer, Modal, confirm, openDialog, toast } from '../ui/overlays'
import { Field } from '../ui/Field'

export function RoleTag({ role }: { role: string }) {
  return <Tag tone={role === 'admin' ? 'warn' : undefined}>{role}</Tag>
}

/** Role names to pick from. */
function useRoleNames(): string[] {
  // duck:if rbac
  const { data } = useResource<Role[]>('/roles')
  return (data || []).map((r) => r.name)
  // duck:else
  // return ['user', 'admin']
  // duck:end
}

function userActions(u: User): MenuEntry[] {
  const self = u.id === getMe()?.user.id
  return [
    { header: u.username },
    { label: t('Open'), onClick: () => go('users', u.id) },
    { label: t('Edit…'), icon: <Pencil size={14} />, onClick: () => openDialog((c) => <UserFormDialog initial={u} onClose={c} />) },
    u.source === 'local' && { label: t('Reset password…'), icon: <KeyRound size={14} />, onClick: () => openDialog((c) => <ResetPasswordDialog user={u} onClose={c} />) },
    'sep',
    !self && { label: u.disabled ? t('Enable') : t('Disable'), icon: u.disabled ? <CheckCircle2 size={14} /> : <Ban size={14} />, onClick: () => setDisabled(u, !u.disabled) },
    !self && {
      label: t('Delete'), icon: <Trash2 size={14} />, danger: true, onClick: async () => {
        if (!(await confirm({ title: t('Delete {0}?', u.username), body: t('Their audit history is kept.'), danger: true, confirm: t('Delete') }))) return
        api.del(`/users/${enc(u.id)}`).then(() => (invalidate('/users'), go('users')), toast.err)
      },
    },
  ]
}

async function setDisabled(u: User, disabled: boolean) {
  if (disabled && !(await confirm({ title: t('Disable {0}?', u.username), body: t('They cannot sign in and their sessions end now.'), danger: true, confirm: t('Disable') }))) return
  api.patch(`/users/${enc(u.id)}`, { disabled }).then(() => invalidate('/users'), toast.err)
}

export function Users({ id }: { id?: string }) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const { data, error, loading } = useResource<Page<User>>(`/users?page=${page}&per_page=${perPage}`)
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (data?.items || []).filter((u) => words.every((w) => `${u.username} ${u.display_name} ${u.role}`.toLowerCase().includes(w)))
  }, [data?.items, q])
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <UsersIcon size={20} />
          <h1>{t('Users')}</h1>
          <span className="count">{data?.total ?? 0}</span>
          {loading && <Spinner />}
        </div>
        <div className="page-actions">
          <div className="search">
            <Search size={14} />
            <input placeholder={t('Search by name or role…')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            {q && <button className="icon-btn" onClick={() => setQ('')}><X size={13} /></button>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => openDialog((c) => <UserFormDialog onClose={c} />)}><Plus size={14} /> {t('User')}</button>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="alert alert-bad">{error.message}</div>}
        <DataTable
          rows={rows}
          rowKey={(u) => u.id}
          onOpen={(u) => go('users', u.id)}
          rowMenu={userActions}
          rowClass={(u) => (u.disabled ? 'dim' : '')}
          defaultSort={{ key: 'name', dir: 1 }}
          pagination={{
            page,
            perPage,
            total: data?.total ?? 0,
            onPageChange: setPage,
            onPerPageChange: (pp) => { setPerPage(pp); setPage(1) },
          }}
          columns={[
            {
              key: 'name', label: t('Name'), sort: (u) => u.username, render: (u) => (
                <span className="cell-name">
                  <Avatar name={u.username} size={26} />
                  <span className="cell-name-text"><strong>{u.display_name || u.username}</strong>{u.display_name && <span className="muted small">{u.username}</span>}</span>
                </span>
              ),
            },
            { key: 'role', label: t('Role'), sort: (u) => u.role, render: (u) => <RoleTag role={u.role} /> },
            { key: 'source', label: t('Source'), sort: (u) => u.source, render: (u) => <span className="muted small">{u.source === 'local' ? t('local') : u.source}</span> },
            { key: 'state', label: t('Status'), sort: (u) => (u.disabled ? 1 : 0), render: (u) => <Pill state={u.disabled ? 'disabled' : 'enabled'} /> },
            { key: 'login', label: t('Last login'), sort: (u) => u.last_login_at ?? '', render: (u) => <span className="muted small" title={dateTime(u.last_login_at)}>{u.last_login_at ? ago(u.last_login_at) : t('never')}</span> },
          ]}
        />
      </div>
      {id && <UserDrawer user={data?.items.find((u) => u.id === id)} onClose={() => go('users')} />}
    </div>
  )
}

function UserDrawer({ user: u, onClose }: { user?: User; onClose: () => void }) {
  return (
    <Drawer onClose={onClose}>
      {!u ? <Spinner /> : (
        <div className="drawer-body">
          <header className="record-head">
            <Avatar name={u.username} size={48} square />
            <div className="record-title">
              <h1>{u.display_name || u.username}</h1>
              <div className="row gap wrap">
                <RoleTag role={u.role} />
                <Pill state={u.disabled ? 'disabled' : 'enabled'} />
                <span className="muted small mono">{u.username}</span>
              </div>
            </div>
            <div className="record-actions"><MenuButton items={() => userActions(u)} className="btn btn-sm" /></div>
          </header>
          <Section title={t('Properties')}>
            <Props items={[
              [t('Source'), u.source === 'local' ? t('local account') : t('system account ({0})', u.source)],
              [t('Last login'), u.last_login_at ? <span title={dateTime(u.last_login_at)}>{ago(u.last_login_at)}</span> : t('never')],
              [t('Created'), <span title={dateTime(u.created_at)}>{ago(u.created_at)}</span>],
            ]} />
          </Section>
        </div>
      )}
    </Drawer>
  )
}

export function UserFormDialog({ initial, onClose }: { initial?: User; onClose: () => void }) {
  const roles = useRoleNames()
  const [v, setV] = useState({ username: initial?.username ?? '', display_name: initial?.display_name ?? '', role: initial?.role ?? 'user', password: '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      if (initial) {
        await api.patch(`/users/${enc(initial.id)}`, { display_name: v.display_name, role: v.role })
      } else {
        const u = await api.post<User>('/users', v)
        go('users', u.id)
      }
      invalidate('/users')
      toast.ok(initial ? t('User saved') : t('User {0} created', v.username))
      onClose()
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? t('Edit {0}', initial.username) : t('New user')}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn btn-primary" disabled={busy || !v.username || (!initial && v.password.length < 10)} onClick={save}>{initial ? t('Save') : t('Create')}</button>
      </>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())}>
        {!initial && (
          <Field label={t('User')} help={t('Lowercase letters, digits, dot, dash and underscore.')}>
            <input autoFocus className="mono" value={v.username} onChange={(e) => setV({ ...v, username: e.currentTarget.value.toLowerCase() })} />
          </Field>
        )}
        <Field label={t('Display name')}>
          <input value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.currentTarget.value })} />
        </Field>
        <Field label={t('Role')}>
          <select value={v.role} onChange={(e) => setV({ ...v, role: e.currentTarget.value })}>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        {!initial && (
          <Field label={t('Password')} help={t('At least 10 characters. They can change it under My account.')}>
            <input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.currentTarget.value })} />
          </Field>
        )}
      </form>
    </Modal>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const save = () =>
    api.put(`/users/${enc(user.id)}/password`, { password: pw }).then(() => (toast.ok(t('Password reset; their sessions ended')), onClose()), toast.err)
  return (
    <Modal
      title={t('Reset the password of {0}', user.username)}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn btn-primary" disabled={pw.length < 10} onClick={save}>{t('Reset')}</button>
      </>}
    >
      <Field label={t('New password')} help={t('At least 10 characters.')}>
        <input autoFocus type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.currentTarget.value)} />
      </Field>
    </Modal>
  )
}

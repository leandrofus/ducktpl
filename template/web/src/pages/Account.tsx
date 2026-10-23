// duck:file auth
import { t } from '../i18n'
import { useState } from 'react'
import { UserCog } from 'lucide-react'
import { api } from '../lib/api'
import { getMe } from '../lib/session'
import { ago } from '../lib/format'
import { Props, Section, Tag } from '../ui/common'
import { toast } from '../ui/overlays'
import { Field } from '../ui/Field'

export function Account() {
  const u = getMe()!.user
  const perms = getMe()!.permissions
  const [v, setV] = useState({ current: '', password: '', again: '' })
  const [busy, setBusy] = useState(false)
  const mismatch = v.again !== '' && v.password !== v.again
  const submit = async () => {
    setBusy(true)
    try {
      await api.put('/auth/me/password', { current: v.current, password: v.password })
      setV({ current: '', password: '', again: '' })
      toast.ok(t('Password changed; your other sessions were signed out'))
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page narrow">
      <div className="page-head">
        <div className="page-title">
          <UserCog size={20} />
          <h1>{t('My account')}</h1>
        </div>
      </div>
      <div className="page-body">
        <Section title={t('Profile')}>
          <Props items={[
            [t('User'), <span className="mono">{u.username}</span>],
            [t('Name'), u.display_name || '—'],
            [t('Role'), <Tag>{u.role}</Tag>],
            [t('Permissions'), <span className="tags">{perms.map((p) => <Tag key={p} mono>{p === '*' ? t('everything') : p}</Tag>)}</span>],
            [t('Last login'), u.last_login_at ? ago(u.last_login_at) : '—'],
          ]} />
        </Section>
        {u.source === 'local' ? (
          <Section title={t('Password')}>
            <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
              <Field label={t('Current password')}>
                <input type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.currentTarget.value })} />
              </Field>
              <Field label={t('New password')} help={t('At least 10 characters.')}>
                <input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.currentTarget.value })} />
              </Field>
              <Field label={t('Repeat it')} help={mismatch ? t('They do not match.') : undefined}>
                <input type="password" autoComplete="new-password" value={v.again} onChange={(e) => setV({ ...v, again: e.currentTarget.value })} />
              </Field>
              <div><button className="btn btn-primary" disabled={busy || !v.current || v.password.length < 10 || v.password !== v.again}>{t('Change password')}</button></div>
            </form>
          </Section>
        ) : (
          <div className="alert">{t('Your password is managed by the host ({0}).', u.source)}</div>
        )}
      </div>
    </div>
  )
}

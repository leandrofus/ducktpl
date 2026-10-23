// duck:file auth
import { t } from '../i18n'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { api } from '../lib/api'
import { Spinner } from '../ui/common'

export function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api.post('/auth/login', { username, password })
      onDone()
    } catch (e: any) {
      setErr(e.message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img className="brand-logo" style={{ width: 56, height: 56, alignSelf: 'center' }} src="/icon.svg" alt="" />
        <h2 style={{ textAlign: 'center', margin: 0 }}>DuckApp</h2>
        <p className="muted" style={{ textAlign: 'center' }}>{t('Sign in to continue.')}</p>
        <input autoFocus autoComplete="username" placeholder={t('user')} value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
        <input type="password" autoComplete="current-password" placeholder={t('password')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        {err && <div className="alert alert-bad">{err}</div>}
        <button className="btn btn-primary" disabled={busy || !username || !password}>
          {busy ? <Spinner /> : <LogIn size={15} />} {t('Sign in')}
        </button>
      </form>
    </div>
  )
}

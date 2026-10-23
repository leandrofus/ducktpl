import { t, LANGUAGES, getLang, setLang } from './i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { StickyNote, Search, Plus, Languages, Moon, Sun, SunMoon, PanelLeftClose, PanelLeft, Settings2 } from 'lucide-react'
// duck:if auth
import { LogOut, UserCog, Users as UsersIcon } from 'lucide-react'
// duck:end
// duck:if rbac
import { ShieldCheck } from 'lucide-react'
// duck:end
// duck:if audit
import { ScrollText } from 'lucide-react'
// duck:end
// duck:if auth
import { api, setUnauthorizedHandler } from './lib/api'
import type { Me } from './lib/api'
import { invalidate } from './lib/store'
import { can, getMe, setMe } from './lib/session'
import { Login } from './pages/Login'
import { Account } from './pages/Account'
import { Users } from './pages/Users'
// duck:end
// duck:if ws|sse
import { startLive, useLive } from './lib/live'
// duck:end
// duck:if rbac
import { Roles } from './pages/Roles'
// duck:end
// duck:if audit
import { Audit } from './pages/Audit'
// duck:end
import type { Note } from './lib/api'
import { peek } from './lib/store'
import { usePref } from './lib/prefs'
import { go, href, useRoute } from './lib/router'
import { ContextMenuProvider, useMenu } from './ui/ContextMenu'
import type { MenuEntry } from './ui/ContextMenu'
import { OverlayHost, openDialog } from './ui/overlays'
import { Avatar, Kbd } from './ui/common'
// duck:if auth
import { Spinner } from './ui/common'
import { toast } from './ui/overlays'
// duck:end
import { Notes, NoteFormDialog } from './pages/Notes'
// ducktpl:imports

interface NavItem {
  id: string
  label: string
  icon: typeof StickyNote
  show?: () => boolean
}

// The sidebar. Add a page: an entry here and a case in Shell.
const NAV: NavItem[] = [
  { id: 'notes', label: t('Notes'), icon: StickyNote },
  // ducktpl:nav
]
const NAV_ADMIN: NavItem[] = [
  // duck:if auth
  { id: 'users', label: t('Users'), icon: UsersIcon, show: () => can('users.manage') },
  // duck:end
  // duck:if rbac
  { id: 'roles', label: t('Roles'), icon: ShieldCheck, show: () => can('roles.manage') },
  // duck:end
  // duck:if audit auth
  { id: 'audit', label: t('Audit log'), icon: ScrollText, show: () => can('audit.read') },
  // duck:end
  // duck:if audit !auth
  // { id: 'audit', label: t('Audit log'), icon: ScrollText },
  // duck:end
]
const visible = (items: NavItem[]) => items.filter((n) => !n.show || n.show())

function Sidebar({ section, collapsed, setCollapsed }: { section: string; collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const item = (n: NavItem) => (
    <a key={n.id} href={href(n.id)} className={`nav-item${section === n.id ? ' active' : ''}`} title={n.label}>
      <n.icon size={16} />
      {!collapsed && <span>{n.label}</span>}
    </a>
  )
  const admin = visible(NAV_ADMIN)
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <a className="workspace" href={href('notes')}>
        <img className="brand-logo" src="/icon.svg" alt="" />
        {!collapsed && (
          <span className="workspace-text">
            <strong>DuckApp</strong>
            <span className="muted small ellipsis">{t('built with create-duck')}</span>
          </span>
        )}
      </a>
      <nav>{visible(NAV).map(item)}</nav>
      {admin.length > 0 && (
        <nav className="nav-section">
          {!collapsed && <div className="nav-title"><Settings2 size={12} /> {t('Administration')}</div>}
          {admin.map(item)}
        </nav>
      )}
      <nav className="nav-bottom">
        <button className="nav-item" onClick={() => setCollapsed(!collapsed)} title={t('Collapse')}>
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>{t('Collapse')}</span>}
        </button>
      </nav>
    </aside>
  )
}

// ---------- command palette (Ctrl K) ----------
interface Cmd {
  id: string
  label: string
  sub?: string
  icon: ReactNode
  group: string
  run: () => void
}

function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const notes = peek<Note[]>('/notes') || []
  const all: Cmd[] = useMemo(
    () => [
      ...notes.map((n) => ({ id: n.id, label: n.title, icon: <StickyNote size={15} />, group: t('Notes'), run: () => go('notes', n.id) })),
      ...visible([...NAV, ...NAV_ADMIN]).map((n) => ({ id: 'nav-' + n.id, label: t('Go to {0}', n.label), icon: <n.icon size={15} />, group: t('Navigation'), run: () => go(n.id) })),
      ...createItems().filter((x): x is { label: string; icon: ReactElement; onClick: () => void } => !!x && typeof x === 'object' && 'onClick' in x).map((x) => ({ id: 'new-' + x.label, label: t('New {0}', x.label.toLowerCase()), icon: x.icon, group: t('Create'), run: x.onClick })),
    ],
    [notes],
  )
  const results = useMemo(() => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (!words.length) return all.slice(0, 50)
    return all.filter((c) => words.every((w) => `${c.label} ${c.sub ?? ''} ${c.group}`.toLowerCase().includes(w))).slice(0, 60)
  }, [q, all])
  useEffect(() => setI(0), [q])
  useEffect(() => {
    list.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [i])
  const run = (c: Cmd) => (onClose(), c.run())
  let lastGroup = ''
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder={t('Search notes, pages or actions…')}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setI(Math.min(i + 1, results.length - 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setI(Math.max(i - 1, 0)))
              else if (e.key === 'Enter' && results[i]) run(results[i])
              else if (e.key === 'Escape') onClose()
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="palette-list" ref={list}>
          {results.length === 0 && <div className="muted center">{t('No results')}</div>}
          {results.map((c, idx) => {
            const header = c.group !== lastGroup ? (lastGroup = c.group) : null
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button className={`palette-item${idx === i ? ' active' : ''}`} onMouseEnter={() => setI(idx)} onClick={() => run(c)}>
                  {c.icon}
                  <span className="grow ellipsis">{c.label}</span>
                  {c.sub && <span className="muted small ellipsis">{c.sub}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette-foot muted small">
          <Kbd>↑↓</Kbd> {t('navigate')} · <Kbd>↵</Kbd> {t('open')}
        </div>
      </div>
    </div>
  )
}

function createItems(): MenuEntry[] {
  return [
    { label: t('Note'), icon: <StickyNote size={14} />, onClick: () => openDialog((c) => <NoteFormDialog onClose={c} />) },
  ]
}

// The menu behind the avatar: who you are, language, sign out.
function accountItems(): MenuEntry[] {
  const languages: MenuEntry = { label: t('Language'), icon: <Languages size={14} />, submenu: LANGUAGES.map((l) => ({ label: l.label, checked: getLang() === l.id, onClick: () => setLang(l.id) })) }
  // duck:if auth
  const u = getMe()!.user
  return [
    { header: u.display_name || u.username },
    { label: t('Role: {0}', u.role), disabled: true },
    'sep',
    { label: t('My account'), icon: <UserCog size={14} />, onClick: () => go('account') },
    languages,
    { label: t('Sign out'), icon: <LogOut size={14} />, onClick: () => api.post('/auth/logout').then(() => location.reload()) },
  ]
  // duck:else
  // return [languages]
  // duck:end
}

function AccountChip() {
  const menu = useMenu()
  // duck:if auth
  const u = getMe()!.user
  const name = u.display_name || u.username
  const sub = u.role
  // duck:else
  // const name = t('Guest')
  // const sub = t('no sign-in')
  // duck:end
  return (
    <button
      className="user-chip"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        menu(accountItems)({ preventDefault() {}, stopPropagation() {}, clientX: r.right - 220, clientY: r.bottom + 4 } as any)
      }}
      onContextMenu={menu(accountItems)}
    >
      <Avatar name={name} size={26} />
      <span className="user-chip-text">
        <strong>{name}</strong>
        <span className="muted small">{sub}</span>
      </span>
    </button>
  )
}

// duck:if ws|sse
function LiveDot() {
  const s = useLive()
  const label = s === 'live' ? t('Live updates on') : s === 'offline' ? t('Live updates lost; reconnecting…') : t('Connecting…')
  return <span className={`live-dot ${s}`} title={label} aria-label={label} />
}
// duck:end

function Topbar({ onSearch }: { onSearch: () => void }) {
  const [theme, setTheme] = usePref<'auto' | 'light' | 'dark'>('theme', 'auto')
  const menu = useMenu()
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  // duck:if ws|sse
  const live = <LiveDot />
  // duck:else
  // const live = null
  // duck:end
  return (
    <header className="topbar">
      <button className="searchbar" onClick={onSearch}>
        <Search size={15} />
        <span>{t('Search…')}</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <span className="grow" />
      {live}
      <button
        className="btn btn-primary btn-sm"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          menu(createItems)({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 } as any)
        }}
      >
        <Plus size={15} /> {t('Create')}
      </button>
      <button className="icon-btn" title={t('Theme: {0}', theme)} onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')}>
        {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <SunMoon size={16} />}
      </button>
      <AccountChip />
    </header>
  )
}

function Shell() {
  const route = useRoute()
  const [collapsed, setCollapsed] = usePref('sidebar.collapsed', false)
  const [palette, setPalette] = useState(false)

  useEffect(() => {
    // duck:if ws|sse
    startLive()
    // duck:end
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      } else if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        e.preventDefault()
        setPalette(true)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const { section, id } = route
  let page: ReactNode
  switch (section) {
    // duck:if auth
    case 'users': page = <Users id={id} />; break
    case 'account': page = <Account />; break
    // duck:end
    // duck:if rbac
    case 'roles': page = <Roles />; break
    // duck:end
    // duck:if audit
    case 'audit': page = <Audit />; break
    // duck:end
    // ducktpl:pages
    default: page = <Notes id={section === 'notes' ? id : undefined} />
  }
  return (
    <div className="app">
      <Sidebar section={section} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="main">
        <Topbar onSearch={() => setPalette(true)} />
        <div className="content">{page}</div>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  )
}

// duck:if auth
export function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking')
  const check = () =>
    api
      .get<Me>('/auth/me')
      .then((m) => (setMe(m), setAuth('in')))
      .catch(() => (setMe(null), setAuth('out')))
  useEffect(() => {
    setUnauthorizedHandler(() => (setMe(null), invalidate(), setAuth('out')))
    check()
  }, [])
  return (
    <ContextMenuProvider>
      {auth === 'checking' && <div className="center page"><Spinner /></div>}
      {auth === 'out' && <Login onDone={() => check().then(() => toast.ok(t('Hello, {0}', getMe()?.user.display_name || getMe()?.user.username)))} />}
      {auth === 'in' && <Shell />}
      <OverlayHost />
    </ContextMenuProvider>
  )
}
// duck:else
// export function App() {
//   return (
//     <ContextMenuProvider>
//       <Shell />
//       <OverlayHost />
//     </ContextMenuProvider>
//   )
// }
// duck:end

import { useState } from 'react'
import { Bell, Check, Trash2, X } from 'lucide-react'
import { t } from '../i18n'

export interface NotificationItem {
  id: string
  title: string
  body?: string
  time: string
  read: boolean
}

export function NotificationBell({
  notifications = [],
  onMarkAllRead,
  onClear,
}: {
  notifications?: NotificationItem[]
  onMarkAllRead?: () => void
  onClear?: () => void
}) {
  const [open, setOpen] = useState(false)
  const unread = notifications.filter((n) => !n.read).length

  return (
    <div className="notifications-wrap">
      <button
        className="icon-btn notifications-trigger"
        onClick={() => setOpen(!open)}
        title={t('Notifications')}
      >
        <Bell size={18} />
        {unread > 0 && <span className="notifications-badge">{unread}</span>}
      </button>

      {open && (
        <div className="notifications-popover">
          <div className="notifications-head">
            <h5>{t('Notifications')}</h5>
            <div className="notifications-actions">
              {unread > 0 && (
                <button className="icon-btn xs" onClick={onMarkAllRead} title={t('Mark all as read')}>
                  <Check size={13} />
                </button>
              )}
              {notifications.length > 0 && (
                <button className="icon-btn xs" onClick={onClear} title={t('Clear all')}>
                  <Trash2 size={13} />
                </button>
              )}
              <button className="icon-btn xs" onClick={() => setOpen(false)}>
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="notifications-list">
            {notifications.length === 0 ? (
              <div className="notifications-empty">{t('No new notifications')}</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`notification-item ${n.read ? 'read' : 'unread'}`}>
                  <div className="notification-title">{n.title}</div>
                  {n.body && <div className="notification-body">{n.body}</div>}
                  <div className="notification-time">{n.time}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

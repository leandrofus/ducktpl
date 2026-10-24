import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getLang, t } from '../../i18n'
import { usePref } from '../../lib/prefs'

// A month and a week view over anything with a start (and maybe an end).
// It knows nothing about resources: ResourcePage's calendar layout feeds it
// rows, and other pages can feed it whatever they have.
//
// An item shows on the day it starts; in the week view one that crosses
// midnight is cut there.

const HOUR = 48 // px per hour in the week view

export interface CalendarProps<T> {
  items: T[]
  start: (x: T) => Date
  /** when it ends; an hour after the start if missing */
  end?: (x: T) => Date | null
  itemKey: (x: T) => string
  render: (x: T) => ReactNode
  onOpen?: (x: T) => void
  /** an empty day or slot was clicked */
  onCreate?: (at: Date) => void
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
/** Monday of the week d is in. */
const weekStart = (d: Date) => addDays(midnight(d), -((d.getDay() + 6) % 7))
const hhmm = (d: Date) => d.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })

export function CalendarView<T>({ items, start, end, itemKey, render, onOpen, onCreate }: CalendarProps<T>) {
  const [view, setView] = usePref<'month' | 'week'>('calendar:view', 'month')
  const [cursor, setCursor] = useState(() => new Date())
  const today = new Date()
  const lang = getLang()

  const first = view === 'month' ? weekStart(new Date(cursor.getFullYear(), cursor.getMonth(), 1)) : weekStart(cursor)
  const days = Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => addDays(first, i))
  const on = (d: Date) => items.filter((x) => sameDay(start(x), d)).sort((a, b) => +start(a) - +start(b))
  const step = (n: number) => setCursor(view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() + n, 1) : addDays(cursor, 7 * n))
  const title = view === 'month'
    ? cursor.toLocaleDateString(lang, { month: 'long', year: 'numeric' })
    : `${days[0].toLocaleDateString(lang, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}`

  return (
    <div className="cal">
      <div className="cal-bar">
        <button className="icon-btn" onClick={() => step(-1)} title={t('Previous')}><ChevronLeft size={16} /></button>
        <button className="icon-btn" onClick={() => step(1)} title={t('Next')}><ChevronRight size={16} /></button>
        <button className="btn btn-sm" onClick={() => setCursor(new Date())}>{t('Today')}</button>
        <strong className="cal-title">{title}</strong>
        <div className="cal-views">
          {(['month', 'week'] as const).map((v) => (
            <button key={v} className={`btn btn-sm${view === v ? ' btn-primary' : ''}`} onClick={() => setView(v)}>{v === 'month' ? t('Month') : t('Week')}</button>
          ))}
        </div>
      </div>
      <div className="cal-head" style={view === 'week' ? { paddingLeft: 44 } : undefined}>
        {days.slice(0, 7).map((d) => <span key={+d}>{d.toLocaleDateString(lang, { weekday: 'short' })}{view === 'week' ? ` ${d.getDate()}` : ''}</span>)}
      </div>
      {view === 'month' ? (
        <div className="cal-month">
          {days.map((d) => {
            const list = on(d)
            return (
              <div key={+d} className={`cal-day${d.getMonth() !== cursor.getMonth() ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}`} onClick={() => onCreate?.(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9))}>
                <span className="cal-num">{d.getDate()}</span>
                {list.slice(0, 3).map((x) => (
                  <button key={itemKey(x)} className="cal-chip" onClick={(e) => (e.stopPropagation(), onOpen?.(x))}>
                    <em>{hhmm(start(x))}</em> {render(x)}
                  </button>
                ))}
                {list.length > 3 && (
                  <button className="cal-more" onClick={(e) => (e.stopPropagation(), setCursor(d), setView('week'))}>{t('{0} more', list.length - 3)}</button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <WeekGrid days={days} today={today} on={on} start={start} end={end} itemKey={itemKey} render={render} onOpen={onOpen} onCreate={onCreate} />
      )}
    </div>
  )
}

function WeekGrid<T>({ days, today, on, start, end, itemKey, render, onOpen, onCreate }: Pick<CalendarProps<T>, 'start' | 'end' | 'itemKey' | 'render' | 'onOpen' | 'onCreate'> & { days: Date[]; today: Date; on: (d: Date) => T[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7.5 * HOUR
  }, [])
  return (
    <div className="cal-week" ref={scroller}>
      <div className="cal-hours">
        {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ height: HOUR }}>{h ? `${String(h).padStart(2, '0')}:00` : ''}</span>)}
      </div>
      {days.map((d) => {
        const midnightMs = +midnight(d)
        const placed = layout(on(d).map((x) => {
          const s = Math.max(0, (+start(x) - midnightMs) / 3600000)
          const e = Math.min(24, ((end?.(x) ? +end(x)! : +start(x) + 3600000) - midnightMs) / 3600000)
          return { x, s, e: Math.max(e, s + 0.5) }
        }))
        return (
          <div
            key={+d}
            className={`cal-col${sameDay(d, today) ? ' today' : ''}`}
            style={{ height: 24 * HOUR }}
            onClick={(e) => {
              const y = e.clientY - e.currentTarget.getBoundingClientRect().top
              onCreate?.(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, Math.floor((y / HOUR) * 2) * 30))
            }}
          >
            {sameDay(d, today) && <div className="cal-now" style={{ top: ((+today - midnightMs) / 3600000) * HOUR }} />}
            {placed.map(({ x, s, e, lane, lanes }) => (
              <button
                key={itemKey(x)}
                className="cal-event"
                style={{ top: s * HOUR, height: (e - s) * HOUR - 2, left: `${(100 * lane) / lanes}%`, width: `calc(${100 / lanes}% - 2px)` }}
                onClick={(ev) => (ev.stopPropagation(), onOpen?.(x))}
              >
                <em>{hhmm(start(x))}</em> {render(x)}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** Puts overlapping events side by side: each takes the first lane that is free. */
function layout<T extends { s: number; e: number }>(list: T[]) {
  const ends: number[] = []
  const out = list.map((it) => {
    let lane = ends.findIndex((e) => e <= it.s)
    if (lane < 0) lane = ends.length
    ends[lane] = it.e
    return { ...it, lane, lanes: 1 }
  })
  // the width an event gets is shared with everything it overlaps
  for (const a of out) a.lanes = Math.max(...out.filter((b) => b.s < a.e && b.e > a.s).map((b) => b.lane + 1))
  return out
}

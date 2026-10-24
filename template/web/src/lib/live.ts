// duck:file ws|sse
import { useEffect, useState } from 'react'
import { invalidate } from './store'

// Live updates: the gateway sends {type, id} when something changes
// (note.changed) and the cached resources of that type refetch.
// duck:if ws
// WebSocket, reconnecting with backoff.
// duck:else
// // Server-Sent Events; EventSource reconnects by itself.
// duck:end

export type LiveState = 'connecting' | 'live' | 'offline'
type Ev = { type: string; id?: string }

let state: LiveState = 'connecting'
const listeners = new Set<() => void>()
const eventListeners = new Set<(ev: Ev) => void>()
export function onLiveEvent(fn: (ev: Ev) => void) {
  eventListeners.add(fn)
  return () => {
    eventListeners.delete(fn)
  }
}
const setState = (s: LiveState) => {
  state = s
  listeners.forEach((l) => l())
}

// Which API path an event's object type lives under.
const PATHS: Record<string, string> = {
  note: '/notes',
  // ducktpl:live
}

function onEvent(ev: Ev) {
  const kind = ev.type.split('.')[0] // note.changed → note
  invalidate(PATHS[kind] ?? `/${kind}s`)
  eventListeners.forEach((fn) => fn(ev))
}

let started = false
export function startLive() {
  if (started) return
  started = true
  // duck:if ws
  let delay = 1000
  const connect = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`)
    ws.onopen = () => {
      delay = 1000
      setState('live')
      invalidate() // catch up on what changed while away
    }
    ws.onmessage = (m) => onEvent(JSON.parse(m.data))
    ws.onclose = () => {
      setState('offline')
      setTimeout(connect, delay)
      delay = Math.min(delay * 2, 30000)
    }
  }
  connect()
  // duck:else
  // const es = new EventSource('/api/v1/events')
  // es.onopen = () => (setState('live'), invalidate())
  // es.onerror = () => setState(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
  // es.addEventListener('note.changed', (m) => onEvent(JSON.parse((m as MessageEvent).data)))
  // duck:end
}

export function useLive(): LiveState {
  const [, f] = useState(0)
  useEffect(() => {
    const l = () => f((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}

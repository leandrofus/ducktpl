import { useSyncExternalStore } from 'react'

// A zustand-shaped store without the dependency: create() returns a hook
// that takes a selector, with get/set/subscribe on the hook itself.
// A selector must return a stable value (a field, not a fresh object).

export type SetState<T> = (partial: Partial<T> | ((s: T) => Partial<T>)) => void

export interface Store<T> {
  get: () => T
  set: SetState<T>
  subscribe: (l: () => void) => () => void
}

export function createStore<T>(init: (set: SetState<T>, get: () => T) => T): Store<T> {
  const listeners = new Set<() => void>()
  let state: T
  const get = () => state
  const set: SetState<T> = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  }
  state = init(set, get)
  return {
    get,
    set,
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
  }
}

export type UseStore<T> = {
  (): T
  <U>(select: (s: T) => U): U
} & Store<T>

export function create<T>(init: (set: SetState<T>, get: () => T) => T): UseStore<T> {
  const store = createStore(init)
  const use = (select: (s: T) => unknown = (s) => s) => useSyncExternalStore(store.subscribe, () => select(store.get()))
  return Object.assign(use, store) as UseStore<T>
}

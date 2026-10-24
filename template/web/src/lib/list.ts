import { create } from './create'
import type { UseStore } from './create'

// The list state of one resource page (page, size, search), kept per API
// path so it survives leaving and coming back to the page.

export interface ListState {
  page: number
  perPage: number
  q: string
  setPage: (page: number) => void
  setPerPage: (perPage: number) => void
  setQ: (q: string) => void
  reset: () => void
}

const stores = new Map<string, UseStore<ListState>>()

export function useList(key: string, perPage = 25): UseStore<ListState> {
  let s = stores.get(key)
  if (!s) {
    s = create<ListState>((set) => ({
      page: 1,
      perPage,
      q: '',
      setPage: (page) => set({ page }),
      setPerPage: (perPage) => set({ perPage, page: 1 }),
      setQ: (q) => set({ q, page: 1 }),
      reset: () => set({ page: 1, q: '' }),
    }))
    stores.set(key, s)
  }
  return s
}

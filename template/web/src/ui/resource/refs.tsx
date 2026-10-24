import { useResource } from '../../lib/store'
import type { Page } from '../../lib/api'
import type { RefDef, Row } from './types'

// The rows a ref field points to, cached by lib/store (one fetch per table).

export function useRefRows(ref: RefDef): Row[] {
  return useResource<Page<Row>>(`${ref.url}?all=1`).data?.items || []
}

/** The human name of the row an id points to. */
export function RefName({ ref, id }: { ref: RefDef; id: string | null | undefined }) {
  const rows = useRefRows(ref)
  return <>{rows.find((o) => o.id === id)?.[ref.show] ?? '—'}</>
}

export function RefOptions({ ref }: { ref: RefDef }) {
  const rows = useRefRows(ref)
  return <>{rows.map((o) => <option key={o.id} value={o.id}>{o[ref.show] || o.id}</option>)}</>
}

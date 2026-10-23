// duck:file auth
import type { Me } from './api'

// The signed-in user and their global permissions, shared by the whole UI.
// The server decides; this only hides what would be refused.
let current: Me | null = null
export const getMe = () => current
export const setMe = (m: Me | null) => {
  current = m
}

export function can(perm: string) {
  const ps = current?.permissions ?? []
  return ps.includes('*') || ps.includes(perm)
}

// duck:if auth
import { can } from './session'
// duck:end

// May the signed-in user do this? The server decides; this hides what it would refuse.
// duck:if auth
export const allowed = (perm?: string) => !perm || can(perm)
// duck:else
// export const allowed = (_perm?: string) => true
// duck:end

// Authentication identity changes synchronously; encrypted account restoration is async.
// Keep the UI and archive reads closed until the matching owner's local state is ready.
let identity: string | null | undefined
let epoch = 0
let ready = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
export function setLocalProgressIdentity(next: string | null | undefined): void {
  if (next === identity) return
  identity = next
  epoch++
  ready = false
  emit()
}
export function markLocalProgressReady(owner: string | null): void {
  if (identity !== owner || ready) return
  ready = true
  emit()
}
export const localProgressReady = () => ready
export function subscribeLocalProgressReady(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function canReadLocalProgress(owner: string | null): boolean {
  return ready && identity !== undefined && identity === owner
}
export function captureLocalProgressAccess(owner: string | null): () => boolean {
  const captured = epoch
  return () => captured === epoch && canReadLocalProgress(owner)
}

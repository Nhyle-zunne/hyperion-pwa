import { afterEach, expect, mock, test } from 'bun:test'
let owner = 'account-a'
let signedAdmin = false
let cache: any = null
let calls: { name: string; action: string }[] = []
let release: (() => void) | undefined
let paused = false
let failed = false
let deferredSessions: ((value: any) => void)[] | null = null
mock.module('../../src/lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => deferredSessions ? new Promise(resolve => { deferredSessions!.push(resolve) }) : ({ data: { session: { user: { id: owner } } } }) },
  functions: { invoke: async (name: string, { body }: any) => {
    calls.push({ name, action: body.action })
    if (paused) await new Promise<void>(resolve => { release = resolve })
    return failed ? { error: new Error('Unavailable') } : { data: { token: 'signed-fixture', isAdmin: true } }
  } }
} }))
mock.module('../../src/lib/offlineQuestionCache', () => ({
  clearOfflineEntitlements: () => { cache = null },
  getCachedOfflineEntitlementSnapshot: async (id?: string) => cache && (!id || cache.userId === id) ? cache : null,
  saveOfflineEntitlements: async (id: string, _token: string, canSave: () => boolean) => {
    if (!canSave()) return false
    cache = { userId: id, isAdmin: signedAdmin, trackExpiries: signedAdmin ? {} : { DECK_OIC_NW: Date.now() + 3600000 } }
    return true
  }
}))
const { useLicenseStore } = await import('../../src/stores/licenseStore')
const refresh = () => useLicenseStore.getState().refreshCloudEntitlements()
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
afterEach(() => {
  useLicenseStore.getState().clearLicense()
  owner = 'account-a'; signedAdmin = false; calls = []; paused = false; failed = false; release = undefined; deferredSessions = null
})
test('one signed lease supplies ordinary access without a redundant admin request', async () => {
  await refresh()
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(true)
  expect(useLicenseStore.getState().isTrackUnlocked('ENGINE_MGT')).toBe(false)
  expect(calls).toEqual([{ name: 'question-bank', action: 'offline-license' }])
})
test('only the verified signed role grants administrator access', async () => {
  signedAdmin = true
  await refresh()
  expect(useLicenseStore.getState().isAllAccessUnlocked).toBe(true)
  expect(calls.length).toBe(1)
})
test('simultaneous same-account refreshes share one signed lease request', async () => {
  paused = true
  const jobs = [refresh(), refresh(), refresh()]
  await flush()
  expect(calls).toEqual([{ name: 'question-bank', action: 'offline-license' }])
  paused = false; release!()
  await Promise.all(jobs)
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(true)
})
test('sign-out prevents a pending signed grant from restoring access', async () => {
  paused = true
  const job = refresh(); await flush()
  useLicenseStore.getState().clearLicense()
  paused = false; release!(); await job
  expect(cache).toBe(null)
  expect(useLicenseStore.getState().isAllAccessUnlocked).toBe(false)
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false)
})
test('a new account does not share the previous accounts pending grant', async () => {
  paused = true
  const oldJob = refresh(); await flush()
  const finishOld = release!
  owner = 'account-b'; signedAdmin = true; paused = false
  await refresh()
  finishOld(); await oldJob
  expect(cache.userId).toBe('account-b')
  expect(useLicenseStore.getState().isAllAccessUnlocked).toBe(true)
  expect(calls.length).toBe(2)
})
test('network failure retains only the valid signed same-account fallback', async () => {
  await refresh()
  failed = true
  await refresh()
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(true)
  expect(useLicenseStore.getState().isAllAccessUnlocked).toBe(false)
})

test('a newer account refresh survives an overlapping older auth lookup', async () => {
  deferredSessions = []
  paused = true
  const older = refresh(), newer = refresh()
  await flush()
  deferredSessions[0]({ data: { session: { user: { id: 'account-a' } } } })
  await flush()
  const finishOldLease = release!
  signedAdmin = true; paused = false
  deferredSessions[1]({ data: { session: { user: { id: 'account-b' } } } })
  await newer
  finishOldLease(); await older
  expect(cache.userId).toBe('account-b')
  expect(useLicenseStore.getState().isAllAccessUnlocked).toBe(true)
})
test('a late old-account auth lookup cannot replace a newer verified account', async () => {
  deferredSessions = []
  const older = refresh(), newer = refresh()
  await flush()
  signedAdmin = true
  deferredSessions[1]({ data: { session: { user: { id: 'account-b' } } } })
  await newer
  deferredSessions[0]({ data: { session: { user: { id: 'account-a' } } } })
  await older
  expect(cache.userId).toBe('account-b')
  expect(calls.length).toBe(1)
})

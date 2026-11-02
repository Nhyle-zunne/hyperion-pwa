import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

let now = 1_800_000_000_000;
let owner = 'account-a';
let expiresAt = now + 5_000;
let snapshotPresent = true;
let hangAuth = false;
let hangBackend = false;
let noSession = false;
let releaseCache: (() => void) | null = null;
let pauseCache = false;
const timers = new Map<number, () => void>();
let timerId = 0;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalNow = Date.now;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

mock.module('../../src/lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => hangAuth ? new Promise(() => {}) : { data: { session: noSession ? null : { user: { id: owner } } } } },
  functions: { invoke: async () => hangBackend ? new Promise(() => {}) : { error: new Error('unreachable') } }
} }));
mock.module('../../src/lib/offlineQuestionCache', () => ({
  clearOfflineEntitlements: () => { snapshotPresent = false; },
  saveOfflineEntitlements: async () => false,
  getCachedOfflineEntitlementSnapshot: async () => {
    const snapshot = snapshotPresent ? { userId: owner, isAdmin: false, trackExpiries: expiresAt > now ? { DECK_OIC_NW: expiresAt } : {} } : null;
    if (pauseCache) await new Promise<void>(resolve => { releaseCache = resolve; });
    return snapshot;
  }
}));
const { useLicenseStore } = await import('../../src/stores/licenseStore');

beforeEach(() => {
  now = 1_800_000_000_000;
  owner = 'account-a';
  expiresAt = now + 5_000;
  snapshotPresent = true;
  hangAuth = false;
  hangBackend = false;
  noSession = false;
  pauseCache = false;
  releaseCache = null;
  Date.now = () => now;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  globalThis.setTimeout = ((callback: () => void) => {
    timers.set(++timerId, callback);
    return timerId;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof clearTimeout;
});
afterEach(() => {
  useLicenseStore.getState().clearLicense();
  timers.clear();
  Date.now = originalNow;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const fireExpiry = async () => {
  now = expiresAt + 1;
  const callback = [...timers.values()][0];
  expect(callback).toBeDefined();
  timers.clear();
  callback();
  await flush();
};

test('offline startup grants a cached track and expires it without a session', async () => {
  await useLicenseStore.getState().refreshCloudEntitlements();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(true);
  expect(useLicenseStore.getState().isTrackUnlocked('ENGINE_OIC_EW')).toBe(false);
  await fireExpiry();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false);
});

test('expiry is local even when reported online and authentication never responds', async () => {
  await useLicenseStore.getState().refreshCloudEntitlements();
  navigator.onLine = true;
  hangAuth = true;
  await fireExpiry();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false);
});

test('a pending cloud refresh does not cancel local expiry enforcement', async () => {
  await useLicenseStore.getState().refreshCloudEntitlements();
  navigator.onLine = true;
  hangBackend = true;
  void useLicenseStore.getState().refreshCloudEntitlements();
  await flush();
  await fireExpiry();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false);
});

test('wake rechecks an expired grant without waiting for cloud authentication', async () => {
  await useLicenseStore.getState().refreshCloudEntitlements();
  now = expiresAt + 1;
  navigator.onLine = true;
  hangAuth = true;
  await useLicenseStore.getState().refreshCachedEntitlements();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false);
});

test('explicit sign-out removes cached offline access', async () => {
  await useLicenseStore.getState().refreshCloudEntitlements();
  useLicenseStore.getState().clearLicense();
  await useLicenseStore.getState().refreshCachedEntitlements();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false);
  expect(timers.size).toBe(0);
});

test('failed online sync preserves the valid same-account offline grant', async () => {
  await useLicenseStore.getState().refreshCloudEntitlements();
  navigator.onLine = true;
  await useLicenseStore.getState().refreshCloudEntitlements();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(true);
  expect(snapshotPresent).toBe(true);
  await fireExpiry();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false);
});

test('wake preserves a valid offline grant without requiring sign-in', async () => {
  await useLicenseStore.getState().refreshCloudEntitlements();
  now += 1_000;
  hangAuth = true;
  await useLicenseStore.getState().refreshCachedEntitlements();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(true);
  expect(snapshotPresent).toBe(true);
});


test('expired authentication does not erase a valid signed offline grant', async () => {
  navigator.onLine = true;
  noSession = true;
  await useLicenseStore.getState().refreshCloudEntitlements();
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(true);
  expect(snapshotPresent).toBe(true);
});

test('in-flight cache verification cannot restore access after intentional sign-out', async () => {
  pauseCache = true;
  const refresh = useLicenseStore.getState().refreshCachedEntitlements();
  await flush();
  useLicenseStore.getState().clearLicense();
  releaseCache!();
  await refresh;
  expect(useLicenseStore.getState().isTrackUnlocked('DECK_OIC_NW')).toBe(false);
  expect(snapshotPresent).toBe(false);
});

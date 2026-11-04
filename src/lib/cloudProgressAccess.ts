import { useLicenseStore } from '../stores/licenseStore'

// Scheduling only. Supabase still verifies account ownership and content rights.
// The account/expiry values come from the cryptographically verified signed lease.
export function canSyncCloudProgress(userId: string | null | undefined): boolean {
  const grant = useLicenseStore.getState()
  return !!userId && grant.entitlementsVerified && grant.cloudSyncVerified && grant.entitlementUserId === userId
    && grant.cloudTrackIds.length > 0 && grant.cloudSyncExpiresAt > Date.now()
}

let accessEpoch = 0
useLicenseStore.subscribe((next, previous) => {
  if (next.cloudSyncVerified !== previous.cloudSyncVerified || next.entitlementUserId !== previous.entitlementUserId || next.entitlementsVerified !== previous.entitlementsVerified
    || next.cloudSyncExpiresAt !== previous.cloudSyncExpiresAt || next.cloudTrackIds.join(',') !== previous.cloudTrackIds.join(',')) accessEpoch++
})

/** A revoked grant must not become valid again for an older pending operation. */
export function captureCloudProgressAccess(userId: string): () => boolean {
  const epoch = accessEpoch
  return () => epoch === accessEpoch && canSyncCloudProgress(userId)
}

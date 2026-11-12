// A single, service-role-only, read-only query is used for BOTH purchase
// channels. Do not cache license grants: refunds, revocations and expiry must
// be enforced on every protected request. The old 2-query path remains only
// for a database that has not yet installed the migration.
export type ActivePaidEntitlement = {
  user_id: string
  track_id: string
  expires_at: string
}
const VALID_TRACKS = new Set(['DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC'])

function canonicalize(
  rows: unknown[],
  userId: string,
  requestedTrack: string | null,
  nowMs: number
): ActivePaidEntitlement[] {
  const byTrack = new Map<string, ActivePaidEntitlement>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid license lookup result.')
    const row = raw as Partial<ActivePaidEntitlement>
    if (row.user_id !== userId || typeof row.track_id !== 'string' ||
        !VALID_TRACKS.has(row.track_id) ||
        (requestedTrack !== null && row.track_id !== requestedTrack) ||
        typeof row.expires_at !== 'string') {
      throw new Error('License result was not scoped to the authenticated account and track.')
    }
    const expiry = Date.parse(row.expires_at)
    if (!Number.isFinite(expiry)) throw new Error('License expiry was invalid.')
    if (expiry <= nowMs) continue
    const previous = byTrack.get(row.track_id)
    if (!previous || Date.parse(previous.expires_at) < expiry) {
      byTrack.set(row.track_id, row as ActivePaidEntitlement)
    }
  }
  return [...byTrack.values()]
}

function missingLegacyPlayTable(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === 'PGRST205' &&
    typeof error.message === 'string' &&
    error.message.toLowerCase().includes('google_play_entitlements') &&
    error.message.toLowerCase().includes('schema cache')
}

export async function loadActivePaidEntitlements(
  admin: any,
  userId: string,
  track: string | null = null
): Promise<ActivePaidEntitlement[]> {
  if (typeof userId !== 'string' || !userId ||
      (track !== null && !VALID_TRACKS.has(track))) {
    throw new Error('Invalid user or track for license lookup.')
  }
  const nowMs = Date.now()
  const { data, error } = await admin.rpc('get_active_paid_track_entitlements', {
    p_user_id: userId, p_track_id: track
  })
  if (!error) {
    if (!Array.isArray(data)) throw new Error('Invalid active license lookup result.')
    return canonicalize(data, userId, track, nowMs)
  }
  if (error.code !== 'PGRST202') throw new Error('Active licenses could not be verified.')

  // One-time rolling-deploy compatibility. A missing RPC alone is safe to
  // fall back; any other RPC error fails closed and never accepts stale access.
  const lookup = (table: string) => {
    let query = admin.from(table).select('user_id,track_id,expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date(nowMs).toISOString())
    if (track !== null) query = query.eq('track_id', track)
    return query
  }
  const [website, play] = await Promise.all([
    lookup('entitlements'), lookup('google_play_entitlements')
  ])
  if (website.error || (play.error && !missingLegacyPlayTable(play.error))) {
    throw new Error('Active licenses could not be verified.')
  }
  return canonicalize([
    ...(website.data ?? []),
    ...(play.error ? [] : (play.data ?? []))
  ], userId, track, nowMs)
}

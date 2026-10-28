import { createClient } from 'npm:@supabase/supabase-js@2'

const DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_DAYS = 30
const PAGE_SIZE = 1000
const MAX_DELETIONS_PER_RUN = 100

type AuthUser = {
  id: string
  email?: string
  created_at: string
  last_sign_in_at?: string | null
  app_metadata?: Record<string, unknown>
}
type Entitlement = { user_id: string; status: string; expires_at: string | null }
type PaymentRow = { user_id: string; status: string; payment_method: string | null; paymongo_checkout_session_id: string | null }
type BatchRow = { user_id: string; status: string }
type ActivityRow = { user_id: string; last_accessed_at: string }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
})
function parseDate(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : 0
}
function profileIsAdmin(user: AuthUser, adminEmails: Set<string>): boolean {
  const email = (user.email || '').toLowerCase()
  const metadata = user.app_metadata || {}
  return adminEmails.has(email) || metadata.role === 'admin' || metadata.is_admin === true
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronToken = req.headers.get('x-hyperion-account-retention-token')
  if (!url || !service || !cronToken) return json({ error: 'Not authorized.' }, 401)

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: tokenIsValid, error: tokenError } = await admin.rpc('verify_account_retention_cron_token', { p_token: cronToken })
  if (tokenError || tokenIsValid !== true) return json({ error: 'Not authorized.' }, 401)

  let dryRun = false
  try {
    const body = await req.json()
    dryRun = body?.dryRun === true
  } catch {
    // The scheduled caller sends a JSON body; a missing body means normal processing.
  }

  const adminEmails = new Set((Deno.env.get('ADMIN_EMAILS') || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
  const now = Date.now()
  const inactivityCutoff = now - RETENTION_DAYS * DAY_MS

  let totalUsers = 0
  let deleted = 0
  let eligible = 0
  let skippedActiveLicense = 0
  let skippedGracePeriod = 0
  let skippedRecentlyActive = 0
  let skippedAdmin = 0
  let skippedPendingPayment = 0
  let skippedAuditDependency = 0
  let failed = 0
  const dryRunCandidates: { userId: string; reason: string; dueAt: string }[] = []

  userPages: for (let page = 1; page <= 100; page++) {
    const usersResult = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (usersResult.error) return json({ error: 'Could not load accounts for retention processing.', processed: totalUsers }, 500)
    const users = (usersResult.data.users || []) as AuthUser[]
    totalUsers += users.length
    if (!users.length) break
    const userIds = users.map(user => user.id)
    const idSet = new Set(userIds)

    const activityMap = new Map<string, string>()
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await admin.from('user_activity').select('user_id,last_accessed_at')
        .in('user_id', userIds).range(offset, offset + PAGE_SIZE - 1)
      if (result.error) return json({ error: 'Could not read account activity; no accounts were deleted in this batch.', processed: totalUsers - users.length }, 500)
      const rows = (result.data || []) as ActivityRow[]
      rows.forEach(row => activityMap.set(row.user_id, row.last_accessed_at))
      if (rows.length < PAGE_SIZE) break
    }

    const entitlements: Entitlement[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await admin.from('entitlements').select('user_id,status,expires_at')
        .in('user_id', userIds).range(offset, offset + PAGE_SIZE - 1)
      if (result.error) return json({ error: 'Could not read license entitlements; no accounts were deleted in this batch.', processed: totalUsers - users.length }, 500)
      const rows = (result.data || []) as Entitlement[]
      entitlements.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    const entitlementMap = new Map<string, Entitlement[]>()
    for (const row of entitlements) {
      const group = entitlementMap.get(row.user_id) || []
      group.push(row)
      entitlementMap.set(row.user_id, group)
    }

    const paymentMap = new Map<string, PaymentRow[]>()
    const paymentQueryFactories = [
      (offset: number) => admin.from('orders').select('user_id,status,payment_method,paymongo_checkout_session_id')
        .in('user_id', userIds).in('status', ['pending', 'submitted']).range(offset, offset + PAGE_SIZE - 1),
      (offset: number) => admin.from('orders').select('user_id,status,payment_method,paymongo_checkout_session_id')
        .in('user_id', userIds).eq('status', 'failed').eq('payment_method', 'PayMongo Checkout')
        .not('paymongo_checkout_session_id', 'is', null).range(offset, offset + PAGE_SIZE - 1)
    ]
    for (const makeQuery of paymentQueryFactories) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const result = await makeQuery(offset)
        if (result.error) return json({ error: 'Could not verify pending payment dependencies; no accounts were deleted in this batch.', processed: totalUsers - users.length }, 500)
        const rows = (result.data || []) as PaymentRow[]
        rows.forEach(row => {
          const group = paymentMap.get(row.user_id) || []
          group.push(row)
          paymentMap.set(row.user_id, group)
        })
        if (rows.length < PAGE_SIZE) break
      }
    }

    const pendingBatchUsers = new Set<string>()
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await admin.from('checkout_batches').select('user_id,status')
        .in('user_id', userIds).eq('status', 'pending').range(offset, offset + PAGE_SIZE - 1)
      if (result.error) return json({ error: 'Could not verify checkout dependencies; no accounts were deleted in this batch.', processed: totalUsers - users.length }, 500)
      const rows = (result.data || []) as BatchRow[]
      rows.forEach(row => pendingBatchUsers.add(row.user_id))
      if (rows.length < PAGE_SIZE) break
    }

    const adminAuditUsers = new Set<string>()
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await admin.from('license_admin_audit').select('admin_user_id')
        .in('admin_user_id', userIds).range(offset, offset + PAGE_SIZE - 1)
      if (result.error) return json({ error: 'Could not verify audit-trail dependencies; no accounts were deleted in this batch.', processed: totalUsers - users.length }, 500)
      const rows = (result.data || []) as { admin_user_id: string }[]
      rows.forEach(row => adminAuditUsers.add(row.admin_user_id))
      if (rows.length < PAGE_SIZE) break
    }

    for (const user of users) {
      if (!dryRun && deleted >= MAX_DELETIONS_PER_RUN) break
      if (!idSet.has(user.id)) continue
      if (profileIsAdmin(user, adminEmails)) { skippedAdmin++; continue }
      if (adminAuditUsers.has(user.id)) { skippedAuditDependency++; continue }

      const userEntitlements = entitlementMap.get(user.id) || []
      const hasActiveLicense = userEntitlements.some(row =>
        row.status === 'active' && parseDate(row.expires_at) > now
      )
      if (hasActiveLicense) { skippedActiveLicense++; continue }

      const latestValidExpiry = userEntitlements.reduce((latest, row) => {
        if (row.status !== 'active') return latest
        const expiry = parseDate(row.expires_at)
        return expiry > latest ? expiry : latest
      }, 0)

      let reason: string
      let dueAt: number
      if (latestValidExpiry > 0) {
        // All licenses have expired; give the account a full 30 days after the latest expiry.
        dueAt = latestValidExpiry + RETENTION_DAYS * DAY_MS
        if (dueAt > now) { skippedGracePeriod++; continue }
        reason = 'license_expired_grace_period_ended'
      } else {
        // Legacy users without tracked visits use their last successful sign-in as the baseline,
        // or account creation if a sign-in timestamp is not available.
        const lastAccess = parseDate(activityMap.get(user.id)) || parseDate(user.last_sign_in_at) || parseDate(user.created_at)
        dueAt = lastAccess + RETENTION_DAYS * DAY_MS
        if (dueAt > now || lastAccess === 0) { skippedRecentlyActive++; continue }
        reason = 'free_account_inactive_30_days'
      }

      const payments = paymentMap.get(user.id) || []
      const hasPendingPayment = payments.length > 0 || pendingBatchUsers.has(user.id)
      if (hasPendingPayment) { skippedPendingPayment++; continue }

      if (dryRun) {
        eligible++
        dryRunCandidates.push({ userId: user.id, reason, dueAt: new Date(dueAt).toISOString() })
        continue
      }

      // Recheck mutable conditions just before deletion, so a renewal, new payment,
      // or fresh website visit racing the daily job cannot cause an account to be deleted.
      const [freshEntitlements, freshActivity, freshPendingOrders, freshFailedCheckout, freshPendingBatch, freshAdminAudit] = await Promise.all([
        admin.from('entitlements').select('status,expires_at').eq('user_id', user.id),
        admin.from('user_activity').select('last_accessed_at').eq('user_id', user.id).maybeSingle(),
        admin.from('orders').select('id').eq('user_id', user.id).in('status', ['pending', 'submitted']).limit(1),
        admin.from('orders').select('id').eq('user_id', user.id).eq('status', 'failed').eq('payment_method', 'PayMongo Checkout').not('paymongo_checkout_session_id', 'is', null).limit(1),
        admin.from('checkout_batches').select('id').eq('user_id', user.id).eq('status', 'pending').limit(1),
        admin.from('license_admin_audit').select('id').eq('admin_user_id', user.id).limit(1)
      ])
      if (freshEntitlements.error || freshActivity.error || freshPendingOrders.error || freshFailedCheckout.error || freshPendingBatch.error || freshAdminAudit.error) {
        failed++
        continue
      }
      if ((freshPendingOrders.data?.length || 0) > 0 || (freshFailedCheckout.data?.length || 0) > 0 || (freshPendingBatch.data?.length || 0) > 0) {
        skippedPendingPayment++
        continue
      }
      if ((freshAdminAudit.data?.length || 0) > 0) {
        skippedAuditDependency++
        continue
      }

      const currentTime = Date.now()
      const currentEntitlements = (freshEntitlements.data || []) as Entitlement[]
      if (currentEntitlements.some(row => row.status === 'active' && parseDate(row.expires_at) > currentTime)) {
        skippedActiveLicense++
        continue
      }
      const currentLatestExpiry = currentEntitlements.reduce((latest, row) => {
        if (row.status !== 'active') return latest
        const expiry = parseDate(row.expires_at)
        return expiry > latest && expiry <= currentTime ? expiry : latest
      }, 0)
      if (currentLatestExpiry > 0) {
        dueAt = currentLatestExpiry + RETENTION_DAYS * DAY_MS
        if (dueAt > currentTime) {
          skippedGracePeriod++
          continue
        }
        reason = 'license_expired_grace_period_ended'
      } else {
        const currentLastAccess = parseDate(freshActivity.data?.last_accessed_at)
          || parseDate(user.last_sign_in_at)
          || parseDate(user.created_at)
        dueAt = currentLastAccess + RETENTION_DAYS * DAY_MS
        if (!currentLastAccess || dueAt > currentTime) {
          skippedRecentlyActive++
          continue
        }
        reason = 'free_account_inactive_30_days'
      }

      eligible++
      const auditInsert = await admin.from('account_retention_audit').insert({
        user_id: user.id,
        action: 'deletion_attempted',
        reason,
        last_accessed_at: activityMap.get(user.id) || user.last_sign_in_at || user.created_at,
        retention_due_at: new Date(dueAt).toISOString(),
        details: {}
      }).select('id').single()
      if (auditInsert.error || !auditInsert.data?.id) { failed++; continue }

      const deletion = await admin.auth.admin.deleteUser(user.id, false)
      if (deletion.error) {
        failed++
        await admin.from('account_retention_audit').update({
          action: 'delete_failed',
          details: { failure: 'Auth deletion returned an error.' }
        }).eq('id', auditInsert.data.id)
        continue
      }

      const auditUpdate = await admin.from('account_retention_audit').update({
        action: 'deleted',
        details: { result: 'deleted', reason }
      }).eq('id', auditInsert.data.id)
      if (auditUpdate.error) failed++
      else deleted++
    }

    if (!dryRun && deleted >= MAX_DELETIONS_PER_RUN) break userPages
    if (users.length < PAGE_SIZE) break
  }

  return json({
    ok: failed === 0,
    dryRun,
    retentionDays: RETENTION_DAYS,
    maximumDeletesPerRun: dryRun ? null : MAX_DELETIONS_PER_RUN,
    processedUsers: totalUsers,
    eligible,
    deleted,
    failed,
    skipped: {
      activeLicense: skippedActiveLicense,
      renewalGracePeriod: skippedGracePeriod,
      recentlyActiveFreeAccount: skippedRecentlyActive,
      admin: skippedAdmin,
      pendingPayment: skippedPendingPayment,
      auditDependency: skippedAuditDependency
    },
    ...(dryRun ? { candidates: dryRunCandidates } : {})
  })
})

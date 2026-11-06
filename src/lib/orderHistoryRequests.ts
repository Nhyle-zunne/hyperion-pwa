import type { SupabaseClient } from '@supabase/supabase-js'

export const ORDER_PAGE_SIZE = 25
const ORDER_COLUMNS = 'id,product_code,license_term,amount_php,status,payment_reference,payment_method,customer_name,customer_company,customer_school,customer_note,admin_note,created_at,paid_at,checkout_batch_id'
const PENDING_COLUMNS = 'id,checkout_batch_id,status,payment_method,created_at'
export type HistoryOrder = {
  id: string
  product_code: string
  license_term: 'week' | 'month' | 'year'
  amount_php: number
  status: string
  payment_reference: string | null
  payment_method: string | null
  customer_name: string | null
  customer_company: string | null
  customer_school: string | null
  customer_note: string | null
  admin_note: string | null
  created_at: string
  paid_at: string | null
  checkout_batch_id: string | null
}
export type PendingOrder = Pick<HistoryOrder, 'id' | 'checkout_batch_id' | 'status' | 'payment_method' | 'created_at'>
type OrderCursor = Pick<HistoryOrder, 'id' | 'created_at'>
type OrderClient = Pick<SupabaseClient, 'from'>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

export async function fetchOrderPage(client: OrderClient, owner: string, cursor?: OrderCursor) {
  let query = client.from('orders').select(ORDER_COLUMNS).eq('user_id', owner)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(ORDER_PAGE_SIZE + 1)
  if (cursor) {
    if (!uuid.test(cursor.id) || !timestamp.test(cursor.created_at) || !Number.isFinite(Date.parse(cursor.created_at))) {
      throw new Error('Invalid order history cursor. Please refresh your orders.')
    }
    // Preserve database microseconds; rounding to milliseconds could skip tied rows.
    query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw new Error('Unable to load your orders and payment history. Please try again.')
  const rows = (data ?? []) as HistoryOrder[]
  return { orders: rows.slice(0, ORDER_PAGE_SIZE), hasMore: rows.length > ORDER_PAGE_SIZE }
}

export async function fetchPendingOrders(client: OrderClient, owner: string): Promise<PendingOrder[]> {
  const pending: PendingOrder[] = []
  let after: string | undefined
  while (true) {
    let query = client.from('orders').select(PENDING_COLUMNS).eq('user_id', owner)
      .eq('status', 'pending').eq('payment_method', 'PayMongo Checkout')
      .order('id', { ascending: true }).limit(100)
    if (after) query = query.gt('id', after)
    const { data, error } = await query
    if (error) throw new Error('Unable to check pending payments. Please refresh your orders.')
    const rows = (data ?? []) as PendingOrder[]
    pending.push(...rows)
    if (rows.length < 100) return pending
    const last = rows[rows.length - 1].id
    if (!uuid.test(last) || (after && last <= after)) throw new Error('Unable to check pending payments. Please refresh your orders.')
    after = last
  }
}

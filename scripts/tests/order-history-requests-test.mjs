import assert from 'node:assert/strict'
import { fetchOrderPage, fetchPendingOrders, ORDER_PAGE_SIZE } from '../../src/lib/orderHistoryRequests.ts'
const owner = '11111111-1111-4111-8111-111111111111'
const rows = Array.from({ length: 61 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(999 - i).padStart(12, '0')}`,
  user_id: owner, created_at: new Date(Date.UTC(2026, 10, 7) - Math.floor(i / 3) * 1000).toISOString(),
  status: i === 42 ? 'pending' : 'paid', payment_method: 'PayMongo Checkout',
  checkout_batch_id: null, customer_note: 'Historical note', product_code: 'oic_nw',
}))
let fail = false
const requests = []
const client = { from(table) {
  const request = { table, filters: [], orders: [] }; requests.push(request)
  const query = {
    select(columns) { request.columns = columns; return query },
    eq(key, value) { request.filters.push([key, 'eq', value]); return query },
    gt(key, value) { request.filters.push([key, 'gt', value]); return query },
    or(value) { request.cursor = value; return query },
    order(key, { ascending }) { request.orders.push([key, ascending]); return query },
    limit(value) { request.limit = value; return query },
    then(resolve) {
      let result = rows.filter(row => request.filters.every(([key, operator, value]) => operator === 'gt' ? row[key] > value : row[key] === value))
      if (request.cursor) {
        const match = request.cursor.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^\)]+)\)$/)
        assert(match, 'Timestamp/ID cursor is explicit and deterministic')
        result = result.filter(row => row.created_at < match[1] || row.created_at === match[2] && row.id < match[3])
      }
      result.sort((a,b) => { for (const [key, asc] of request.orders) { const delta = String(a[key]).localeCompare(String(b[key])); if (delta) return asc ? delta : -delta } return 0 })
      result = result.slice(0, request.limit).map(row => Object.fromEntries(request.columns.split(',').map(column => [column, row[column]])))
      return Promise.resolve({ data: fail ? null : result, error: fail ? new Error('Synthetic query failure') : null }).then(resolve)
    },
  }; return query
} }
const first = await fetchOrderPage(client, owner)
assert.equal(first.orders.length, ORDER_PAGE_SIZE)
assert.equal(first.hasMore, true)
assert.equal(requests[0].limit, 26, 'Only one small page plus a lookahead row is requested')
assert(!requests[0].columns.includes('reviewed_at'), 'Unused review timestamps are not transferred')
const cursor = first.orders.at(-1)
// A newer insertion must not shift the next page or duplicate the last visible row.
rows.unshift({ ...rows[0], id: '00000000-0000-4000-8000-000000999999', created_at: '2026-11-08T00:00:00.000Z' })
const second = await fetchOrderPage(client, owner, cursor)
assert.equal(second.orders.length, 25)
assert(!second.orders.some(row => first.orders.some(prior => prior.id === row.id)))
const third = await fetchOrderPage(client, owner, second.orders.at(-1))
assert.equal(third.orders.length, 11)
assert.equal(third.hasMore, false)
assert.equal(new Set([...first.orders,...second.orders,...third.orders].map(row => row.id)).size, 61, 'All original history remains reachable without gaps, including equal timestamps')
const pending = await fetchPendingOrders(client, owner)
assert.equal(pending.length, 1)
assert.equal(pending[0].id, rows.find(row => row.status === 'pending').id, 'Pending orders outside the visible page are discovered')
assert(!requests.at(-1).columns.includes('customer_note'), 'Background checks exclude full order details')
assert(requests.every(request => request.filters.some(([key, op, value]) => key === 'user_id' && op === 'eq' && value === owner)), 'Every query is explicitly account-scoped')
const beforePendingPages = requests.length
rows.push(...Array.from({ length: 205 }, (_, index) => ({ ...rows[0], id: `00000000-0000-4000-8000-${String(10000 + index).padStart(12, '0')}`, status: 'pending' })))
assert.equal((await fetchPendingOrders(client, owner)).length, 206, 'Pending discovery does not silently truncate at one page')
assert.equal(requests.length - beforePendingPages, 3)
await fetchOrderPage(client, owner, { id: rows[0].id, created_at: '2026-11-07T00:00:00.123456+00:00' })
assert(requests.at(-1).cursor.includes('.123456+00:00'), 'Cursor preserves database microseconds instead of rounding them away')
fail = true
await assert.rejects(fetchOrderPage(client, owner), /Unable to load/)
await assert.rejects(fetchPendingOrders(client, owner), /Unable to check/)
await assert.rejects(fetchOrderPage(client, owner, { id: 'bad,or', created_at: 'invalid' }), /Invalid order/)
console.log('PASS: small order pages, cursor ties/inserts, full history access, narrow pending checks, ownership and query failures')

import assert from 'node:assert/strict'
import { loadActivePaidEntitlements } from '../functions/_shared/activePaidEntitlements.ts'

const ownerA = '11111111-1111-4111-8111-111111111111'
const ownerB = '22222222-2222-4222-8222-222222222222'
const future = new Date(Date.now() + 86400000).toISOString()
const later = new Date(Date.now() + 2 * 86400000).toISOString()

Deno.test('one authenticated server-only RPC returns current multi-channel paid grants', async () => {
  let calls = 0
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls++
      assert.equal(name,'get_active_paid_track_entitlements')
      assert.deepEqual(args,{p_user_id:ownerA,p_track_id:null})
      return {data:[
        {user_id:ownerA,track_id:'DECK_OIC_NW',expires_at:future},
        {user_id:ownerA,track_id:'ENGINE_OIC_EW',expires_at:later}
      ],error:null}
    },
    from: () => { throw Error('A successful RPC must not issue any separate table reads') }
  }
  const actual = await loadActivePaidEntitlements(admin,ownerA)
  assert.deepEqual(actual.map(item=>item.track_id),['DECK_OIC_NW','ENGINE_OIC_EW'])
  assert.equal(calls,1)
})

Deno.test('scoped paid track lookup never accepts other-owner data, bad expiry or wrong track', async () => {
  const rpc = (data: unknown) => ({
    rpc: async () => ({data,error:null}),
    from: () => {throw Error('Never fall back after a valid RPC response')}
  })
  assert.deepEqual(await loadActivePaidEntitlements(rpc([]),ownerA,'DECK_OIC_NW'),[])
  await assert.rejects(
    loadActivePaidEntitlements(rpc([{user_id:ownerB,track_id:'DECK_OIC_NW',expires_at:future}]),ownerA,'DECK_OIC_NW'),
    /scoped/
  )
  await assert.rejects(
    loadActivePaidEntitlements(rpc([{user_id:ownerA,track_id:'ENGINE_MGT',expires_at:future}]),ownerA,'DECK_OIC_NW'),
    /scoped/
  )
  await assert.rejects(
    loadActivePaidEntitlements(rpc([{user_id:ownerA,track_id:'DECK_OIC_NW',expires_at:'not-a-date'}]),ownerA,'DECK_OIC_NW'),
    /expiry/
  )
  const expired = new Date(Date.now()-86400000).toISOString()
  assert.deepEqual(await loadActivePaidEntitlements(rpc([{user_id:ownerA,track_id:'DECK_OIC_NW',expires_at:expired}]),ownerA),[])
})

Deno.test('outage fails closed; only missing RPC triggers legacy indexed read fallback', async () => {
  const failed = {
    rpc: async () => ({data:null,error:{code:'PGRST500',message:'Database failed'}}),
    from: () => {throw Error('Outages cannot use stale fallback grants')}
  }
  await assert.rejects(loadActivePaidEntitlements(failed,ownerA),/could not be verified/)

  const queried: {table:string,eq:Record<string,string>}[] = []
  const lookup = (table:string) => {
    const filters:Record<string,string>={}
    const builder:any = {
      select: () => builder,
      eq: (key:string,value:string) => {filters[key]=value;return builder},
      gt: () => builder,
      then: (resolve:(value:unknown)=>void) => {
        queried.push({table,eq:{...filters}})
        const data = table === 'entitlements'
          ? [{user_id:ownerA,track_id:'DECK_OIC_NW',expires_at:future}]
          : [{user_id:ownerA,track_id:'DECK_OIC_NW',expires_at:later}]
        return Promise.resolve({data,error:null}).then(resolve)
      }
    }
    return builder
  }
  const fallback = {
    rpc: async () => ({data:null,error:{code:'PGRST202',message:'RPC not available yet'}}),
    from: lookup
  }
  const values=await loadActivePaidEntitlements(fallback,ownerA,'DECK_OIC_NW')
  assert.equal(values.length,1)
  assert.equal(values[0].expires_at,later)
  assert.deepEqual(queried.map(q=>q.table).sort(),['entitlements','google_play_entitlements'])
  for(const q of queried) {
    assert.equal(q.eq.user_id,ownerA)
    assert.equal(q.eq.status,'active')
    assert.equal(q.eq.track_id,'DECK_OIC_NW')
  }
})

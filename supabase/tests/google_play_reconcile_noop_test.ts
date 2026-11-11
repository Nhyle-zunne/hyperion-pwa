import { canSkipUnchangedGooglePlayWrite } from '../functions/reconcile-google-play-subscriptions/noop.ts'

const now = Date.parse('2026-11-12T00:00:00.000Z')
const expires = '2026-11-15T00:00:00.000Z'
const link = {
  status: 'active',
  subscription_state: 'SUBSCRIPTION_STATE_ACTIVE',
  product_ids: ['hyperion_oic_nw_pass'],
  expires_at: expires,
  last_verified_at: '2026-11-11T23:55:00.000Z'
}
const grant = {
  track_id: 'DECK_OIC_NW',
  product_code: 'oic_nw',
  status: 'active',
  expires_at: expires
}
const expected = {
  status: 'active',
  subscription_state: 'SUBSCRIPTION_STATE_ACTIVE',
  product_ids: ['hyperion_oic_nw_pass'],
  expires_at: expires,
  entitlements: [grant]
}
const canSkip = (
  existing = link,
  current = [grant],
  verified = expected,
  replacement = false,
  clock = now
) => canSkipUnchangedGooglePlayWrite(existing,current,verified,clock,replacement)
const check = (value: unknown, reason: string) => {
  if (value !== true) throw Error('Expected safe no-op: '+reason)
}
const mustReconcile = (value: unknown, reason: string) => {
  if (value !== false) throw Error('Must reconcile instead of skipping: '+reason)
}

Deno.test('fresh Google-verification with unchanged licensed grant saves no duplicate RPC write', () => {
  check(canSkip(),'exact subscription state and grant')
  check(canSkip({ ...link, product_ids: ['hyperion_oic_nw_pass'] }),
    'stable products')
})

Deno.test('Google cancellations, refunds and changed expiry dates still reconcile immediately', () => {
  mustReconcile(canSkip(link,[grant],{...expected,status:'inactive',entitlements:[{...grant,status:'revoked'}]}),
    'early revocation')
  mustReconcile(canSkip(link,[grant],{...expected,subscription_state:'SUBSCRIPTION_STATE_CANCELED'}),
    'cancel state change, even if still paid until expiry')
  mustReconcile(canSkip(link,[grant],{...expected,expires_at:'2026-11-18T00:00:00Z'}),
    'renewal expiry changed')
  mustReconcile(canSkip(link,[grant],{...expected,product_ids:[]}),
    'Google product withdrawn')
  mustReconcile(canSkip(link,[grant],{...expected,entitlements:[{...grant,expires_at:'2026-11-16T00:00:00Z'}]}),
    'per-track expiry changed')
})

Deno.test('stale verification, wrong account state, extra grant and replacement never skip the RPC', () => {
  mustReconcile(canSkip({ ...link, last_verified_at:'2026-11-11T18:00:00Z' }),
    'six-hour maximum persistence checkpoint')
  mustReconcile(canSkip({...link,last_verified_at:'2026-11-12T00:01:00Z'}),
    'future server clock')
  mustReconcile(canSkip({...link,last_verified_at:'not-a-date'}),
    'corrupted server timestamp')
  mustReconcile(canSkip(link,[grant],expected,true),
    'prior Google token must be retired')
  mustReconcile(canSkip({...link,status:'inactive'}),'saved status is wrong')
  mustReconcile(canSkip(link,[{...grant,status:'revoked'}]),'missing active grant')
  mustReconcile(canSkip(link,[grant,{...grant,track_id:'GMDSS_GOC'}]),
    'extra grant that must be removed')
  mustReconcile(canSkip(link,[]),'missing expected grant')
  mustReconcile(canSkip({...link,product_ids:['hyperion_oic_nw_pass','hyperion_oic_nw_pass']}),
    'duplicate stored product')
})

Deno.test('expired or revoked entitlements cannot be silently reactivated by the no-op fast path',()=>{
  const past = '2026-11-11T11:00:00.000Z'
  const inactive = {...link,status:'inactive',subscription_state:'SUBSCRIPTION_STATE_EXPIRED',product_ids:[],expires_at:past}
  const revoked = {...grant,status:'revoked',expires_at:past}
  const next = {...expected,status:'inactive',subscription_state:'SUBSCRIPTION_STATE_EXPIRED',product_ids:[],expires_at:past,entitlements:[revoked]}
  check(canSkip(inactive,[revoked],next), 'stable expired token with revoked grants')
  mustReconcile(canSkip(inactive,[{...revoked,status:'active'}],next),
    'active grant must be revoked after expiry')
  mustReconcile(canSkip(inactive,[revoked],{...next,status:'active'}),
    'reactivation changes state')
  mustReconcile(canSkip(inactive,[revoked],{...next,entitlements:[{...revoked,status:'active'}]}),
    'verified active grant with expired date must fail closed')
})

import assert from 'node:assert/strict'
import {
  lifetimeProduct,
  lifetimeProducts,
  isAcceptedLifetimeOrderAmount,
  validatePaidLifetimeSession,
  lifetimePaymentSha256,
  finalizeVerifiedLifetimePayment,
  refundedPaymentIdForEvent,
  hasLifetimePaymongoWebhook
} from '../functions/_shared/paymongoLifetime.ts'

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  product_code: 'gmdss',
  track_id: 'GMDSS_GOC',
  amount_php: 599,
  currency: 'PHP',
  status: 'pending',
  paymongo_livemode: false,
  paymongo_checkout_session_id: 'cs_123'
}
const paidSession = (amountMinor = 59900) => ({
  id: 'cs_123',
  attributes: {
    reference_number: order.id,
    livemode: false,
    metadata: {
      kind: 'lifetime',
      order_id: order.id,
      user_id: order.user_id,
      product_code: order.product_code
    },
    payments: [{
      id: 'pay_lifetime123456',
      attributes: { status: 'paid', currency: 'PHP', amount: amountMinor }
    }]
  }
})

Deno.test('one-time catalogue has five separate tracks with agreed PayMongo prices', () => {
  assert.deepEqual(Object.keys(lifetimeProducts).sort(), ['deck_mgt','engine_ew','engine_mgt','gmdss','oic_nw'])
  assert.deepEqual(
    Object.fromEntries(Object.entries(lifetimeProducts).map(([key,value]) => [key,value.amountPhp])),
    {gmdss:599,oic_nw:999,engine_ew:999,deck_mgt:1999,engine_mgt:1999}
  )
  for (const [code, current, historical] of [
    ['gmdss', 599, 1999],
    ['oic_nw', 999, 2499],
    ['engine_ew', 999, 2499],
    ['deck_mgt', 1999, 4999],
    ['engine_mgt', 1999, 4999]
  ] as const) {
    assert.equal(isAcceptedLifetimeOrderAmount(code, current), true)
    assert.equal(isAcceptedLifetimeOrderAmount(code, historical), true)
    assert.equal(isAcceptedLifetimeOrderAmount(code, current - 1), false)
  }
  assert.equal(lifetimeProduct('all_access'), null)
  assert.equal(lifetimeProduct('__proto__'), null)
})

Deno.test('only one exact paid and owner-bound QR Ph checkout grants lifetime proof', () => {
  assert.deepEqual(validatePaidLifetimeSession(paidSession(),order,false),{
    sessionId:'cs_123',paymentId:'pay_lifetime123456',amountMinor:59900,currency:'PHP',livemode:false
  })
  const mutations: Array<(x: any) => void> = [
    x => { x.id = 'cs_else' },
    x => { x.attributes.reference_number = 'other' },
    x => { x.attributes.livemode = true },
    x => { x.attributes.metadata.kind = 'year' },
    x => { x.attributes.metadata.order_id = 'other' },
    x => { x.attributes.metadata.user_id = 'other' },
    x => { x.attributes.metadata.product_code = 'oic_nw' },
    x => { x.attributes.payments[0].attributes.status = 'processing' },
    x => { x.attributes.payments[0].attributes.currency = 'USD' },
    x => { x.attributes.payments[0].attributes.amount = 59901 },
    x => { x.attributes.payments.push(x.attributes.payments[0]) },
    x => { x.attributes.payments[0].id = 'invalid' }
  ]
  for (const mutate of mutations) {
    const fake = paidSession()
    mutate(fake)
    assert.equal(validatePaidLifetimeSession(fake,order,false),null)
  }
  assert.equal(validatePaidLifetimeSession(paidSession(),{...order,user_id:'different'},false),null)
  assert.deepEqual(
    validatePaidLifetimeSession(paidSession(199900),{...order,amount_php:1999},false),
    {sessionId:'cs_123',paymentId:'pay_lifetime123456',amountMinor:199900,currency:'PHP',livemode:false}
  )
  assert.equal(validatePaidLifetimeSession(paidSession(),{...order,amount_php:1999},false),null)
  assert.equal(validatePaidLifetimeSession(paidSession(),{...order,amount_php:25},false),null)
  assert.equal(validatePaidLifetimeSession(paidSession(),{...order,track_id:'DECK_MGT'},false),null)
  assert.equal(validatePaidLifetimeSession(paidSession(),order,true),null)
})

Deno.test('verified amount and hashed receipt alone are sent to atomic service-only finalizer', async () => {
  let called = 0
  const admin = {
    rpc: async (name: string,args: Record<string,unknown>) => {
      called++
      assert.equal(name,'finalize_paymongo_lifetime_checkout')
      assert.equal(args.p_order_id,order.id)
      assert.equal(args.p_checkout_session_id,'cs_123')
      assert.equal(args.p_payment_id,'pay_lifetime123456')
      assert.equal(args.p_payment_ref_sha256,await lifetimePaymentSha256('pay_lifetime123456'))
      assert.equal(args.p_amount_minor,59900)
      assert.equal(args.p_currency,'PHP')
      assert.equal(args.p_livemode,false)
      return {data:{status:'paid',orderId:order.id,productCode:'gmdss'},error:null}
    }
  }
  const result = await finalizeVerifiedLifetimePayment(admin,order,paidSession(),false)
  assert.equal(result.status,'paid')
  assert.equal(called,1)
  await assert.rejects(
    finalizeVerifiedLifetimePayment(admin,order,{...paidSession(),id:'wrong'},false),
    /did not match/
  )
  assert.equal(called,1)
})

Deno.test('refund notifications grant no rights and only successful refund revokes', () => {
  assert.equal(refundedPaymentIdForEvent('payment.refunded',{
    id:'pay_lifetime123456',attributes:{status:'refunded'}
  }),'pay_lifetime123456')
  assert.equal(refundedPaymentIdForEvent('payment.refunded',{
    id:'pay_lifetime123456',attributes:{status:'paid'}
  }),null)
  assert.equal(refundedPaymentIdForEvent('payment.refund.updated',{
    attributes:{status:'succeeded',payment_id:'pay_lifetime123456'}
  }),'pay_lifetime123456')
  assert.equal(refundedPaymentIdForEvent('payment.refund.updated',{
    attributes:{status:'pending',payment_id:'pay_lifetime123456'}
  }),null)
  assert.equal(refundedPaymentIdForEvent('payment.refund.updated',{
    attributes:{status:'succeeded',payment_id:'other'}
  }),null)
})

Deno.test('reuse configured PayMongo webhook only if signed paid and refund events are subscribed', () => {
  const endpoint='https://evnjoezffghtrzqacwcj.supabase.co/functions/v1/paymongo-webhook'
  const hook = {
    type:'webhook',
    attributes:{
      url:endpoint,events:['checkout_session.payment.paid','payment.refund.updated'],
      livemode:true,status:'enabled'
    }
  }
  assert.equal(hasLifetimePaymongoWebhook([hook],endpoint,true),true)
  assert.equal(hasLifetimePaymongoWebhook([hook],endpoint,false),false)
  assert.equal(hasLifetimePaymongoWebhook([hook],endpoint+'/other',true),false)
  assert.equal(hasLifetimePaymongoWebhook([{...hook,attributes:{...hook.attributes,status:'disabled'}}],endpoint,true),false)
  assert.equal(hasLifetimePaymongoWebhook([{...hook,attributes:{...hook.attributes,events:['checkout_session.payment.paid']}}],endpoint,true),false)
  assert.equal(hasLifetimePaymongoWebhook([{...hook,attributes:{...hook.attributes,events:['payment.refund.updated']}}],endpoint,true),false)
  assert.equal(hasLifetimePaymongoWebhook([{...hook,attributes:{...hook.attributes,events:['checkout_session.payment.paid','payment.refunded']}}],endpoint,true),true)
  assert.equal(hasLifetimePaymongoWebhook([hook], 'http://localhost:54321/webhook',true),false)
  assert.equal(hasLifetimePaymongoWebhook([],endpoint,true),false)
})


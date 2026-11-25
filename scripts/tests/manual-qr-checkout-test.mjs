import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BANK_TRANSFER, formatMessengerPaymentDetails, parseManualCheckoutItems } from '../../src/lib/manualQrCheckout.ts'

const products = [
  { code: 'oic_nw', label: 'Deck OIC-NW', weeklyPrice: 29, monthlyPrice: 79, annualPrice: 499, lifetimePrice: 999 },
  { code: 'gmdss', label: 'GMDSS GOC', weeklyPrice: 25, monthlyPrice: 59, annualPrice: 399, lifetimePrice: 599 },
]

test('checkout uses the catalogue prices for selected subscription and lifetime plans', () => {
  assert.deepEqual(parseManualCheckoutItems('oic_nw:month,gmdss:lifetime', products), [
    { code: 'oic_nw', label: 'Deck OIC-NW', term: 'month', amountPhp: 79 },
    { code: 'gmdss', label: 'GMDSS GOC', term: 'lifetime', amountPhp: 599 },
  ])
})

test('checkout rejects unknown, duplicate, or malformed selections rather than showing a partial amount', () => {
  assert.deepEqual(parseManualCheckoutItems('oic_nw:month,oic_nw:year', products), [])
  assert.deepEqual(parseManualCheckoutItems('oic_nw:month,other:week', products), [])
  assert.deepEqual(parseManualCheckoutItems('oic_nw:month,gmdss:decade', products), [])
  assert.deepEqual(parseManualCheckoutItems('oic_nw:month:0', products), [])
})

test('Messenger text is copyable with exact email, tracks, durations, and total in PHP', () => {
  const items = parseManualCheckoutItems('oic_nw:month,gmdss:lifetime', products)
  assert.equal(formatMessengerPaymentDetails('boss@example.com', items, '12345678-1234-4234-8234-123456789abc'), [
    'Hyperion Maritime - Payment Verification',
    'Submission ID: 12345678-1234-4234-8234-123456789abc',
    'Account email: boss@example.com',
    '',
    'Purchased:',
    'Deck OIC-NW (Monthly): PHP 79.00',
    'GMDSS GOC (Lifetime): PHP 599.00',
    'Total amount: PHP 678.00',
    '',
    'Status: Pending verification (NOT payment confirmation).',
    'I have attached my payment receipt. Please verify my payment and activate the selected licenses.',
  ].join('\n'))
})

test('bank transfer copy text contains the exact receiving account supplied by Hyperion', () => {
  assert.deepEqual(BANK_TRANSFER, {
    bank: 'BPI / VYBE by BPI',
    accountName: 'Hyperion',
    accountNumber: '4309192465',
  })
})

test('checkout keeps the supplied QR-only Hyperion image byte-for-byte', () => {
  const qrImage = readFileSync(new URL('../../public/qr-ph.png', import.meta.url))
  assert.equal(createHash('sha256').update(qrImage).digest('hex'), '806683055bed9e87124692566bf1d1150dbc4b03d32503767a78035d76626afe')
})

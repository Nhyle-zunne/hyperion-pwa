import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { BANK_TRANSFER, parseManualCheckoutItems } from '../../src/lib/manualQrCheckout.ts'
import { decodeQrPixels } from '../../src/lib/qrImageEditor.mjs'
import { listQrPhDataFields } from '../../src/lib/qrPhNameEditor.mjs'

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

test('bank transfer copy text contains the exact receiving account supplied by Hyperion', () => {
  assert.deepEqual(BANK_TRANSFER, {
    bank: 'MARIBANK PHILIPPINES INC.',
    accountName: 'HYPERION MARITIME',
    accountNumber: '14075599602',
  })
})

test('checkout keeps the supplied Hyperion Maritime QR image byte-for-byte', () => {
  const qrImage = readFileSync(new URL('../../public/qr-ph.png', import.meta.url))
  assert.equal(createHash('sha256').update(qrImage).digest('hex'), 'f874612442151198a3f7e950917fbd8445cdc686c5d310be964ff1a0e975e5ea')
})

test('QR payment recipient and account number match the displayed bank details', () => {
  const qrImage = PNG.sync.read(readFileSync(new URL('../../public/qr-ph.png', import.meta.url)))
  const data = decodeQrPixels({ data: new Uint8ClampedArray(qrImage.data), width: qrImage.width, height: qrImage.height })
  const fields = listQrPhDataFields(data)
  assert.equal(fields.find(field => field.tag === '59')?.value, BANK_TRANSFER.accountName)
  assert.equal(fields.find(field => field.tag === '27.04')?.value, BANK_TRANSFER.accountNumber)
})

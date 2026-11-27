import test from 'node:test'
import assert from 'node:assert/strict'
import { crc16Qr, parseQrPhPayload, replaceQrPhRecipientName } from '../../src/lib/qrPhNameEditor.mjs'

// Synthetic account details; no real payment destination or customer data.
const ORIGINAL = '00020101021127300012com.p2pqrpay0102AB040496025204601653036085802PH5908OLD NAME6004TEST6304F723'

test('recognizes a valid QR Ph payload and reads the encoded recipient name', () => {
  assert.equal(crc16Qr('123456789'), '29B1')
  assert.deepEqual(parseQrPhPayload(ORIGINAL), { recipientName: 'OLD NAME', country: 'PH', currency: 'PHP' })
})

test('replaces only the recipient name and updates the EMV checksum', () => {
  const edited = replaceQrPhRecipientName(ORIGINAL, 'HYPERION MARITIME')
  assert.match(edited, /5917HYPERION MARITIME/)
  assert.deepEqual(parseQrPhPayload(edited), { recipientName: 'HYPERION MARITIME', country: 'PH', currency: 'PHP' })
  assert.equal(edited.replace(/5917HYPERION MARITIME/, '5908OLD NAME').slice(0, -4), ORIGINAL.slice(0, -4))
  assert.notEqual(edited.slice(-4), ORIGINAL.slice(-4))
})

test('rejects invalid checksums and malformed TLV records', () => {
  assert.throws(() => parseQrPhPayload(ORIGINAL.slice(0, -1) + '0'), /checksum/i)
  assert.throws(() => parseQrPhPayload('https://hyperionmaritime.org'), /QR Ph/i)
  assert.throws(() => parseQrPhPayload('0002015908OLD NAME6304FFFF'), /checksum|QR Ph/i)
})

test('rejects unsupported names and never makes an unchanged name seem edited', () => {
  assert.throws(() => replaceQrPhRecipientName(ORIGINAL, ' '), /name/i)
  assert.throws(() => replaceQrPhRecipientName(ORIGINAL, 'A'.repeat(26)), /25/i)
  assert.throws(() => replaceQrPhRecipientName(ORIGINAL, 'HELLO 🔱'), /characters/i)
  assert.equal(replaceQrPhRecipientName(ORIGINAL, ' OLD NAME '), ORIGINAL)
})

test('only supports QR Ph P2P recipient-account schemes with populated account data', () => {
  const resign = value => value + crc16Qr(value)
  const otherScheme = ORIGINAL.slice(0, -4).replace('com.p2pqrpay', 'com.notp2pqr')
  const emptyTemplate = ORIGINAL.slice(0, -4).replace('27300012com.p2pqrpay0102AB04049602', '2700')
  const missingRecipientAccount = ORIGINAL.slice(0, -4).replace('27300012com.p2pqrpay0102AB04049602', '27220012com.p2pqrpay9902AB')
  assert.throws(() => parseQrPhPayload(resign(otherScheme)), /supported|QR Ph/i)
  assert.throws(() => parseQrPhPayload(resign(emptyTemplate)), /supported|QR Ph/i)
  assert.throws(() => parseQrPhPayload(resign(missingRecipientAccount)), /supported|QR Ph/i)
})

test('preserves UTF-8 text in untouched fields and validates the updated checksum over bytes', () => {
  const body = ORIGINAL.slice(0, -4).replace('6004TEST', '6008München')
  const source = body + crc16Qr(body)
  const edited = replaceQrPhRecipientName(source, 'HYPERION MARITIME')
  assert.ok(edited.includes('6008München'))
  assert.equal(parseQrPhPayload(edited).recipientName, 'HYPERION MARITIME')
})

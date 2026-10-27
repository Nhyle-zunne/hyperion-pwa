#!/usr/bin/env node
/**
 * Safely replace one encrypted CSV in Hyperion's private Supabase Storage.
 *
 * Usage:
 *   node scripts/update-question-bank.mjs ./updated.csv deck/oic_nw_c1.csv.enc
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * The service-role key must stay in the local shell; never commit it.
 * Keep deriveKeyBytes() synchronized with question-bank/index.ts.
 */
import { createCipheriv, randomBytes } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ASSET_PATHS = new Set([
  "deck/oic_nw_c1.csv.enc",
  "deck/oic_nw_c10.csv.enc",
  "deck/oic_nw_c11.csv.enc",
  "deck/oic_nw_c12.csv.enc",
  "deck/oic_nw_c13.csv.enc",
  "deck/oic_nw_c17.csv.enc",
  "deck/oic_nw_c2.csv.enc",
  "deck/oic_nw_c3.csv.enc",
  "deck/oic_nw_c4.csv.enc",
  "deck/oic_nw_c5.csv.enc",
  "deck/oic_nw_c7.csv.enc",
  "deck/oic_nw_c9.csv.enc",
  "deck_mgt/dm_c1.csv.enc",
  "deck_mgt/dm_c10.csv.enc",
  "deck_mgt/dm_c11.csv.enc",
  "deck_mgt/dm_c12.csv.enc",
  "deck_mgt/dm_c13.csv.enc",
  "deck_mgt/dm_c14.csv.enc",
  "deck_mgt/dm_c15.csv.enc",
  "deck_mgt/dm_c16.csv.enc",
  "deck_mgt/dm_c17.csv.enc",
  "deck_mgt/dm_c18.csv.enc",
  "deck_mgt/dm_c2.csv.enc",
  "deck_mgt/dm_c20.csv.enc",
  "deck_mgt/dm_c3.csv.enc",
  "deck_mgt/dm_c4.csv.enc",
  "deck_mgt/dm_c5.csv.enc",
  "deck_mgt/dm_c6.csv.enc",
  "deck_mgt/dm_c8.csv.enc",
  "deck_mgt/dm_c9.csv.enc",
  "engine_ew/ew_c1.csv.enc",
  "engine_ew/ew_c10.csv.enc",
  "engine_ew/ew_c11.csv.enc",
  "engine_ew/ew_c15.csv.enc",
  "engine_ew/ew_c16.csv.enc",
  "engine_ew/ew_c2.csv.enc",
  "engine_ew/ew_c3.csv.enc",
  "engine_ew/ew_c4.csv.enc",
  "engine_ew/ew_c5.csv.enc",
  "engine_ew/ew_c6.csv.enc",
  "engine_ew/ew_c7.csv.enc",
  "engine_ew/ew_c8.csv.enc",
  "engine_ew/ew_c9.csv.enc",
  "engine_mgt/em_c1.csv.enc",
  "engine_mgt/em_c10.csv.enc",
  "engine_mgt/em_c11.csv.enc",
  "engine_mgt/em_c12.csv.enc",
  "engine_mgt/em_c13.csv.enc",
  "engine_mgt/em_c14.csv.enc",
  "engine_mgt/em_c2.csv.enc",
  "engine_mgt/em_c3.csv.enc",
  "engine_mgt/em_c4.csv.enc",
  "engine_mgt/em_c5.csv.enc",
  "engine_mgt/em_c6.csv.enc",
  "engine_mgt/em_c7.csv.enc",
  "engine_mgt/em_c8.csv.enc",
  "engine_mgt/em_c9.csv.enc",
  "gmdss/c1_part1.csv.enc",
  "gmdss/c1_part10.csv.enc",
  "gmdss/c1_part2.csv.enc",
  "gmdss/c1_part3.csv.enc",
  "gmdss/c1_part4.csv.enc",
  "gmdss/c1_part5.csv.enc",
  "gmdss/c1_part6.csv.enc",
  "gmdss/c1_part7.csv.enc",
  "gmdss/c1_part8.csv.enc",
  "gmdss/c1_part9.csv.enc",
  "gmdss/c2_part1.csv.enc",
  "gmdss/c2_part2.csv.enc"
])

function deriveKeyBytes() {
  const a = [186,37,40,56,208,70,77,77,49,140,108,238,27,237,38,131]
  const b = [54,195,118,105,37,110,229,154,71,100,190,64,176,245,192,212]
  const all = [...a, ...b]
  const result = Buffer.alloc(all.length)
  for (let i = 0; i < all.length; i++) {
    const m = ((i * 37 + 11) ^ (i << 3)) & 0xff
    result[i] = (all[i] ^ m ^ 0x5a) & 0xff
  }
  return result
}

function encryptCsv(raw) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKeyBytes(), iv)
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()])
  const tag = cipher.getAuthTag()
  // Edge Function format: 12-byte IV + ciphertext + 16-byte auth tag.
  return Buffer.concat([iv, ciphertext, tag])
}

async function main() {
  const [, , inputArg, targetPath] = process.argv
  if (!inputArg || !targetPath) {
    throw new Error('Usage: node scripts/update-question-bank.mjs <updated.csv> <private-object-path.csv.enc>')
  }
  if (!inputArg.toLowerCase().endsWith('.csv')) throw new Error('Input must be a raw .csv file.')
  if (!ASSET_PATHS.has(targetPath)) throw new Error('Target path is not one of the 69 supported private question assets.')
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your local shell first.')

  const raw = await readFile(resolve(inputArg))
  // Preserve the existing 1 MiB maximum after the 12-byte IV and 16-byte tag are added.
  if (raw.length < 20 || raw.length > 1024 * 1024 - 28) {
    throw new Error('CSV size must be between 20 bytes and just under 1 MiB. Check the selected file.')
  }
  const readable = raw.toString('utf8').replace(/^\uFEFF/, '').trim()
  if (!readable || !readable.includes(',')) throw new Error('Input does not look like a CSV file. No upload was made.')
  const encrypted = encryptCsv(raw)

  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const bucket = supabase.storage.from('question-banks')
  const existing = await bucket.download(targetPath)
  if (existing.error || !existing.data) {
    throw new Error('Could not read the existing private object for a safe update. Nothing was overwritten: ' + (existing.error?.message || 'No object returned.'))
  }

  const backupDir = resolve('question-bank-backups')
  await mkdir(backupDir, { recursive: true })
  const safePath = targetPath.replaceAll('/', '__')
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const backupPath = join(backupDir, safePath + '.' + stamp + '.bak.enc')
  await writeFile(backupPath, Buffer.from(await existing.data.arrayBuffer()))

  const result = await bucket.upload(targetPath, encrypted, {
    contentType: 'application/octet-stream',
    cacheControl: '0',
    upsert: true
  })
  if (result.error) throw new Error('Upload failed; rollback copy saved at ' + backupPath + ': ' + result.error.message)

  console.log('Updated private question asset: ' + targetPath)
  console.log('Encrypted size: ' + encrypted.length + ' bytes')
  console.log('Rollback backup: ' + backupPath)
  console.log('Online question-bank cache expires within 15 seconds. Refresh Hyperion and verify the competence.')
  console.log('Devices with offline packs must download that track bank again to receive the updated questions.')
}

main().catch(error => {
  console.error('Question-bank update failed: ' + (error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
})

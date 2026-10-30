import {
  matchesObfuscatedHyperionAccount,
  obfuscatedHyperionAccountId
} from '../functions/link-google-play-subscription/account-binding.ts'

Deno.test('Hyperion Play account identifiers are stable, distinct, and non-PII hashes', async () => {
  const accountA = await obfuscatedHyperionAccountId('account-a-user-uuid')
  const accountARepeat = await obfuscatedHyperionAccountId(' account-a-user-uuid ')
  const accountB = await obfuscatedHyperionAccountId('account-b-user-uuid')

  if (accountA.length !== 64 || !/^[0-9a-f]{64}$/.test(accountA)) {
    throw new Error('Expected a 64-character lowercase SHA-256 hex identifier.')
  }
  if (accountA !== accountARepeat) throw new Error('The same user must generate a stable identifier.')
  if (accountA === accountB) throw new Error('Different users must not generate the same identifier.')
  if (accountA.includes('account-a-user-uuid')) throw new Error('The identifier must not contain the raw user ID.')
})

Deno.test('Google Play account binding accepts matching and legacy purchases only', async () => {
  const expected = await obfuscatedHyperionAccountId('hyperion-user-a')
  const other = await obfuscatedHyperionAccountId('hyperion-user-b')

  if (!matchesObfuscatedHyperionAccount(expected, expected)) {
    throw new Error('A purchase bound to the current Hyperion account should be accepted.')
  }
  if (matchesObfuscatedHyperionAccount(other, expected)) {
    throw new Error('A purchase bound to another Hyperion account must be rejected.')
  }
  if (!matchesObfuscatedHyperionAccount(undefined, expected)) {
    throw new Error('Legacy purchases without account identifiers must remain linkable.')
  }
  if (!matchesObfuscatedHyperionAccount('', expected)) {
    throw new Error('Legacy purchases with an empty identifier must remain linkable.')
  }
  if (matchesObfuscatedHyperionAccount(42, expected)) {
    throw new Error('Malformed identifiers must not be treated as an unbound legacy purchase.')
  }
})

Deno.test('Empty Hyperion account IDs cannot be hashed', async () => {
  let rejected = false
  try {
    await obfuscatedHyperionAccountId('  ')
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('An empty Hyperion user ID must be rejected.')
})

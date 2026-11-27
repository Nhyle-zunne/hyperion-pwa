export type ManualCheckoutTerm = 'week' | 'month' | 'year' | 'lifetime'

export const BANK_TRANSFER = {
  bank: 'MARIBANK PHILIPPINES INC.',
  accountName: 'HYPERION MARITIME',
  accountNumber: '14075599602',
} as const

type PricedProduct = {
  code: string
  label: string
  weeklyPrice: number
  monthlyPrice: number
  annualPrice: number
  lifetimePrice: number
}

export type ManualCheckoutItem = {
  code: string
  label: string
  term: ManualCheckoutTerm
  amountPhp: number
}

export function parseManualCheckoutItems(raw: string | null, products: readonly PricedProduct[]): ManualCheckoutItem[] {
  const selected = new Set<string>()
  const items: ManualCheckoutItem[] = []
  if (!raw) return []
  const entries = raw.split(',')
  if (entries.length > products.length) return []
  for (const entry of entries) {
    const [code, term, extra] = entry.split(':')
    const product = products.find(candidate => candidate.code === code)
    if (!product || extra !== undefined || selected.has(code) ||
        (term !== 'week' && term !== 'month' && term !== 'year' && term !== 'lifetime')) return []
    selected.add(code)
    items.push({
      code,
      label: product.label,
      term,
      amountPhp: term === 'week' ? product.weeklyPrice
        : term === 'month' ? product.monthlyPrice
        : term === 'year' ? product.annualPrice : product.lifetimePrice,
    })
  }
  return items
}

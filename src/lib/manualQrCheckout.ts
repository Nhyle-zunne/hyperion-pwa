export type ManualCheckoutTerm = 'week' | 'month' | 'year' | 'lifetime'

export const BANK_TRANSFER = {
  bank: 'BPI / VYBE by BPI',
  accountName: 'Hyperion',
  accountNumber: '4309192465',
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

const termNames: Record<ManualCheckoutTerm, string> = {
  week: 'Weekly', month: 'Monthly', year: 'Yearly', lifetime: 'Lifetime',
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

export function formatMessengerPaymentDetails(email: string, items: readonly ManualCheckoutItem[]): string {
  const total = items.reduce((sum, item) => sum + item.amountPhp, 0)
  return [
    'Hyperion Maritime - Payment Verification',
    `Account email: ${email}`,
    '',
    'Purchased:',
    ...items.map(item => `${item.label} (${termNames[item.term]}): PHP ${item.amountPhp.toFixed(2)}`),
    `Total amount: PHP ${total.toFixed(2)}`,
    '',
    'I have attached my payment receipt. Please verify my payment and activate the selected licenses.',
  ].join('\n')
}

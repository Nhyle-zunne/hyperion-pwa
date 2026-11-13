// All new PWA orders use these server-side prices.
// Previously recorded PayMongo orders can retain their original verified amount.
export const termPrices = {
  oic_nw: { week: 29, month: 79, year: 499 },
  gmdss: { week: 25, month: 59, year: 399 },
  engine_ew: { week: 29, month: 79, year: 499 },
  deck_mgt: { week: 59, month: 149, year: 999 },
  engine_mgt: { week: 59, month: 149, year: 999 },
};

export const legacyTermPrices = {
  oic_nw: { week: 20, month: 50, year: 350 },
  gmdss: { week: 15, month: 40, year: 250 },
  engine_ew: { week: 20, month: 50, year: 350 },
  deck_mgt: { week: 40, month: 100, year: 700 },
  engine_mgt: { week: 40, month: 100, year: 700 },
};

export function isAcceptedStoredPrice(productCode, term, amount) {
  const current = termPrices[productCode]?.[term];
  const legacy = legacyTermPrices[productCode]?.[term];
  return Number.isSafeInteger(amount) && current !== undefined && (amount === current || amount === legacy);
}

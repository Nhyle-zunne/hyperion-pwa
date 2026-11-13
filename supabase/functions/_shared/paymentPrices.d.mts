export type PaymentTerm = 'week' | 'month' | 'year';
export type PaymentProduct = 'oic_nw' | 'gmdss' | 'engine_ew' | 'deck_mgt' | 'engine_mgt';
export declare const termPrices: Record<PaymentProduct, Record<PaymentTerm, number>>;
export declare const legacyTermPrices: Record<PaymentProduct, Record<PaymentTerm, number>>;
export declare function isAcceptedStoredPrice(productCode: string, term: string, amount: number): boolean;

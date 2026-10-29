import type { CosmeticPack, PlusProduct } from '@bargu/schemas';
import { create } from 'zustand';

/** A price as the store gives it: its own localised text, and the amount for comparing. */
export interface StorePrice {
  /** Play Billing's formatted price ("₺799,99"), shown as it comes. */
  formatted: string;
  micros: number;
}

/**
 * Prices as the store gives them (Google Play Billing's localised price, in lira), for Bargu+ and
 * the look packs, set when the store is connected (Faz 10). Until then there are none, and no price
 * is shown anywhere: never a fixed or guessed one (the PM, QA-42: Play does not allow a wrong
 * price). Without one nothing can be bought or approved (purchasePrice).
 */
export const useStorePrices = create<{
  plus: Partial<Record<PlusProduct, StorePrice>>;
  packs: Partial<Record<CosmeticPack, StorePrice>>;
}>(() => ({ plus: {}, packs: {} }));

/** A Bargu+ plan's price as the store says it, or null when it is not known. */
export function plusPrice(product: PlusProduct): string | null {
  return useStorePrices.getState().plus[product]?.formatted ?? null;
}

/** A look pack's price as the store says it, or null when it is not known. */
export function packPrice(pack: CosmeticPack): string | null {
  return useStorePrices.getState().packs[pack]?.formatted ?? null;
}

/**
 * What a purchase costs, as the one who buys or approves it sees it (the PM, 2026-10-30: nobody
 * buys, and no parent approves, what they have not seen the price of): the store's price; on a
 * test server, where nothing is paid, that it is a test; else null, and the purchase is off.
 */
export function purchasePrice(
  store: string | null | undefined,
  testing: boolean,
  testWords: string,
): string | null {
  if (store !== null && store !== undefined) return store;
  return testing ? testWords : null;
}

/** How much the yearly plan saves against twelve months, when the store gives both; else null. */
export function yearlySaving(prices: Partial<Record<PlusProduct, StorePrice>>): number | null {
  const month = prices.plus_month?.micros;
  const year = prices.plus_year?.micros;
  if (month === undefined || year === undefined || month <= 0) return null;
  return Math.round((1 - year / (month * 12)) * 100);
}

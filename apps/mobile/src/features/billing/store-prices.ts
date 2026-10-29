import type { PlusProduct } from '@bargu/schemas';
import { create } from 'zustand';

/** A price as the store gives it: its own localised text, and the amount for comparing. */
export interface StorePrice {
  /** Play Billing's formatted price ("₺799,99"), shown as it comes. */
  formatted: string;
  micros: number;
}

/**
 * Bargu+ prices as the store gives them (Google Play Billing's localised price), set when the store
 * is connected (Faz 10). Until then there are none, and no price is shown anywhere: never a fixed
 * or guessed one (the PM, QA-42: Play does not allow a wrong price).
 */
export const useStorePrices = create<{ plus: Partial<Record<PlusProduct, StorePrice>> }>(() => ({
  plus: {},
}));

/** A Bargu+ plan's price as the store says it, or null when it is not known. */
export function plusPrice(product: PlusProduct): string | null {
  return useStorePrices.getState().plus[product]?.formatted ?? null;
}

/** How much the yearly plan saves against twelve months, when the store gives both; else null. */
export function yearlySaving(prices: Partial<Record<PlusProduct, StorePrice>>): number | null {
  const month = prices.plus_month?.micros;
  const year = prices.plus_year?.micros;
  if (month === undefined || year === undefined || month <= 0) return null;
  return Math.round((1 - year / (month * 12)) * 100);
}

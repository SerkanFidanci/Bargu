import { useEffect } from 'react';
import { create } from 'zustand';

import { cosmeticFx } from '@/theme';

/**
 * Pins that want to move their look claim a place, in the order they ask; only the first
 * `maxAnimated` move, the rest hold still (docs/ADR/0025, the addendum of 2026-10-21). The user's
 * own pin (`first`) goes ahead of the others and is never left out by them.
 */
export interface Claim {
  id: string;
  first: boolean;
}

/** Who may move now: the claims with `first` ahead, each side in the order it came, the first few. */
export function granted(
  claims: readonly Claim[],
  max: number = cosmeticFx.maxAnimated,
): Set<string> {
  const ordered = [
    ...claims.filter((claim) => claim.first),
    ...claims.filter((claim) => !claim.first),
  ];
  return new Set(ordered.slice(0, max).map((claim) => claim.id));
}

/** The claims now, oldest first. */
export const useSlots = create<{ claims: readonly Claim[] }>(() => ({ claims: [] }));

function claim(id: string, first: boolean): void {
  useSlots.setState((state) => ({
    claims: [...state.claims.filter((existing) => existing.id !== id), { id, first }],
  }));
}

function release(id: string): void {
  useSlots.setState((state) => ({ claims: state.claims.filter((existing) => existing.id !== id) }));
}

/**
 * Whether this pin may move its look now. Wanting is the caller's (a moving style, sade mod "full",
 * a fresh location); not wanting claims nothing, so a still pin never takes a place.
 */
export function useAnimationSlot(id: string, wanted: boolean, first = false): boolean {
  useEffect(() => {
    if (!wanted) return;
    claim(id, first);
    return () => {
      release(id);
    };
  }, [id, wanted, first]);
  return useSlots((state) => wanted && granted(state.claims).has(id));
}

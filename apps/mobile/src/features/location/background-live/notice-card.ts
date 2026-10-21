import { create } from 'zustand';

import { isVaultOpen, vault } from '../../storage/vault';
import type { KeyValueStore } from '../../storage/vault';

/** The one-time explanation (docs/ADR/0028 step 3) has been seen: kept on this phone only. */
const KEY = 'bglive:card:v1';

export function cardSeen(store: KeyValueStore): boolean {
  return store.get(KEY) === '1';
}

export function markCardSeen(store: KeyValueStore): void {
  store.set(KEY, '1');
}

/**
 * Whether the explanation was seen. It starts as seen so nothing flashes before the vault is
 * read; `restoreCard` reads the vault.
 */
export const useCardSeen = create<{ seen: boolean }>(() => ({ seen: true }));

/** The open app's start (and a settings screen): reads whether the card was seen. */
export function restoreCard(): void {
  if (isVaultOpen()) useCardSeen.setState({ seen: cardSeen(vault()) });
}

/** "Tamam", or the user looked at the setting itself: the card does not show again. */
export function dismissCard(): void {
  if (isVaultOpen()) markCardSeen(vault());
  useCardSeen.setState({ seen: true });
}

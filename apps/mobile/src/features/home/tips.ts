import { create } from 'zustand';

import { isVaultOpen, vault } from '../storage/vault';
import type { KeyValueStore } from '../storage/vault';

/**
 * First-use tips on the map (the PM report T6, 2026-10-29): three short bubbles, each once, in this
 * order and only when they mean something here: the + (always), holding a person (once someone is
 * on the map), the story ring (once someone has a new story). Kept on this phone only.
 */
export const TIPS = ['plus', 'hold', 'ring'] as const;
export type Tip = (typeof TIPS)[number];

const KEY = 'tips:v1';

export function tipsSeen(store: KeyValueStore): Tip[] {
  const raw = store.get(KEY);
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? TIPS.filter((tip) => parsed.includes(tip)) : [];
  } catch {
    return [];
  }
}

/** Seen tips; null until the vault is read, so nothing shows before it is known. */
export const useTipsSeen = create<{ seen: readonly Tip[] | null }>(() => ({ seen: null }));

/** The map's start: reads which tips were seen. */
export function restoreTips(): void {
  if (isVaultOpen() && useTipsSeen.getState().seen === null) {
    useTipsSeen.setState({ seen: tipsSeen(vault()) });
  }
}

/** "Tamam", or the thing itself was used: the tip does not show again. */
export function markTipSeen(tip: Tip): void {
  const seen = useTipsSeen.getState().seen ?? [];
  if (seen.includes(tip)) return;
  const next = [...seen, tip];
  useTipsSeen.setState({ seen: next });
  if (isVaultOpen()) vault().set(KEY, JSON.stringify(next));
}

/**
 * The tip to show now: the first not seen whose moment has come; none while a card asks something
 * on the map (a tip waits for it) or before the vault is read.
 */
export function tipNow(
  seen: readonly Tip[] | null,
  here: { people: boolean; newStory: boolean; busy: boolean },
): Tip | null {
  if (seen === null || here.busy) return null;
  const due: Record<Tip, boolean> = { plus: true, hold: here.people, ring: here.newStory };
  return TIPS.find((tip) => due[tip] && !seen.includes(tip)) ?? null;
}

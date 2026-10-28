import { useLayoutEffect } from 'react';
import { create } from 'zustand';

/**
 * The cards that ask something of the user on the map, in the order they get the screen: one at a
 * time, never on top of each other (the PM, 2026-10-21). The location permission comes first (the
 * map is of little use without it), then the choice after a reinstall, the notification question,
 * the weekly "who sees you" reminder, and last the one-time explanation of background live mode
 * (docs/ADR/0028 step 3). A card that has to wait shows as soon as the one in front is closed, and
 * how many wait shows under it as "+N" (the PM report T4, 2026-10-29).
 */
export const MAP_CARDS = [
  'locationPermission',
  'newPhone',
  'notificationPrompt',
  'sharingReminder',
  'backgroundLive',
] as const;
export type MapCard = (typeof MAP_CARDS)[number];

const useWanting = create<Record<MapCard, boolean>>(() => ({
  locationPermission: false,
  newPhone: false,
  notificationPrompt: false,
  sharingReminder: false,
  backgroundLive: false,
}));

/** How many cards wait behind the one in front (0 with one card or none). */
export function cardsWaiting(wanting: Readonly<Record<MapCard, boolean>>): number {
  return Math.max(0, MAP_CARDS.filter((card) => wanting[card]).length - 1);
}

/** The cards waiting behind the one on screen, for its "+N". */
export function useCardsWaiting(): number {
  return useWanting(cardsWaiting);
}

/** Whether a card asks something on the map now (a first-use tip waits for it). */
export function useCardShowing(): boolean {
  return useWanting((state) => cardInFront(state) !== undefined);
}

/** The card that has the screen now: the first, in {@link MAP_CARDS} order, that wants it. */
export function cardInFront(wanting: Readonly<Record<MapCard, boolean>>): MapCard | undefined {
  return MAP_CARDS.find((card) => wanting[card]);
}

/**
 * A card says whether it wants the screen (`wants`: whatever makes it show on its own) and shows
 * only when this returns true, that is when it is the one in front. Every card first registers
 * (before the screen is drawn) and only then does the one in front appear, so two cards are never
 * on screen together, not even for a frame.
 */
export function useMapCardTurn(card: MapCard, wants: boolean): boolean {
  useLayoutEffect(() => {
    useWanting.setState({ [card]: wants });
    return () => {
      useWanting.setState({ [card]: false });
    };
  }, [card, wants]);
  return useWanting((state) => cardInFront(state) === card);
}

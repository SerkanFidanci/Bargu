import type { ChatItem } from './messages';

/** Items of one sender this close together read as one run: one name, joined corners, one avatar. */
const RUN_MS = 5 * 60_000;
/** After a pause this long (or on a new day) the time is shown above the next item, centred. */
const STAMP_MS = 15 * 60_000;

/** The calendar day of a moment, on this phone's clock. */
export const dayOf = (at: number) => new Date(at).toDateString();

type Placed = Pick<ChatItem, 'from' | 'at'>;

/**
 * Where an item stands in its conversation (the owner, 2026-10-28: "like Instagram's DMs"):
 * whether it starts or ends a run of one sender's items, and whether the time goes above it (the
 * first item, a new day, or after a pause). A run never crosses a time.
 */
export function placeIn(
  item: Placed,
  older: Placed | undefined,
  newer: Placed | undefined,
): { first: boolean; last: boolean; stamp: boolean } {
  const stampBetween = (a: Placed | undefined, b: Placed) =>
    a === undefined || dayOf(a.at) !== dayOf(b.at) || b.at - a.at >= STAMP_MS;
  const together = (a: Placed | undefined, b: Placed | undefined) => {
    if (a === undefined || b === undefined) return false;
    return a.from === b.from && b.at - a.at < RUN_MS && !stampBetween(a, b);
  };
  return {
    first: !together(older, item),
    last: !together(item, newer),
    stamp: stampBetween(older, item),
  };
}

/** How long ago, as the list says it ("şimdi", "5 dk", "3 sa"): items live a day at most. */
export function ago(
  at: number,
  now: number,
): { key: 'now' } | { key: 'minutes' | 'hours'; count: number } {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return { key: 'now' };
  if (minutes < 60) return { key: 'minutes', count: minutes };
  return { key: 'hours', count: Math.floor(minutes / 60) };
}

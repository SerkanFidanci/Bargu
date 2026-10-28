import type { ChatItem } from './messages';

/** Items of one sender this close together read as one run: one name, one time, one tail. */
const RUN_MS = 5 * 60_000;

/** The calendar day of a moment, on this phone's clock. */
export const dayOf = (at: number) => new Date(at).toDateString();

/**
 * Where an item stands in its conversation (the owner, 2026-10-28: the items ran together): whether
 * it starts or ends a run of one sender's items, and whether a new day starts with it.
 */
export function placeIn(
  item: Pick<ChatItem, 'from' | 'at'>,
  older: Pick<ChatItem, 'from' | 'at'> | undefined,
  newer: Pick<ChatItem, 'from' | 'at'> | undefined,
): { first: boolean; last: boolean; newDay: boolean } {
  const together = (
    a: Pick<ChatItem, 'from' | 'at'> | undefined,
    b: Pick<ChatItem, 'from' | 'at'> | undefined,
  ) => {
    if (a === undefined || b === undefined) return false;
    return a.from === b.from && Math.abs(a.at - b.at) < RUN_MS && dayOf(a.at) === dayOf(b.at);
  };
  return {
    first: !together(older, item),
    last: !together(item, newer),
    newDay: older === undefined || dayOf(older.at) !== dayOf(item.at),
  };
}

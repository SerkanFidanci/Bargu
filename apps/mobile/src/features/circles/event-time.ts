import { EVENT_DURATION_MS } from '@bargu/schemas';

import { endOfDay } from '../location/sharing';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The ends offered when creating an event (docs/ADR/0017). */
export const EVENT_ENDS = ['hours1', 'hours3', 'tonight', 'tomorrow', 'week'] as const;
export type EventEnd = (typeof EVENT_ENDS)[number];

/** When an event created now with this choice ends; null when the choice does not fit (too late). */
export function eventEndAt(choice: EventEnd, now: number): number | null {
  const at = {
    hours1: now + HOUR,
    hours3: now + 3 * HOUR,
    tonight: endOfDay(now),
    tomorrow: endOfDay(now + 24 * HOUR),
    week: now + EVENT_DURATION_MS.max - MINUTE,
  }[choice];
  return at - now >= EVENT_DURATION_MS.min && at - now <= EVENT_DURATION_MS.max ? at : null;
}

/** What is left of an event: hours and minutes, rounded up (it never shows "0" before the end). */
export function timeLeft(expiresAt: number, now: number): { hours: number; minutes: number } {
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / MINUTE));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** How much of the event is still ahead (1 at the start, 0 at the end), for the countdown ring. */
export function remainingShare(startedAt: number, expiresAt: number, now: number): number {
  const total = expiresAt - startedAt;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (expiresAt - now) / total));
}

/** Event circles whose end has come (the phone ends them on its own, on time). */
export function endedEvents(
  circles: readonly { id: string; expiresAt?: number | undefined }[],
  now: number,
): string[] {
  return circles
    .filter((circle) => circle.expiresAt !== undefined && circle.expiresAt <= now)
    .map((circle) => circle.id);
}

/** When the next event of these circles ends (to wake up then), or null when none is running. */
export function nextEventEnd(
  circles: readonly { expiresAt?: number | undefined }[],
  now: number,
): number | null {
  let next: number | null = null;
  for (const circle of circles) {
    if (circle.expiresAt === undefined || circle.expiresAt <= now) continue;
    if (next === null || circle.expiresAt < next) next = circle.expiresAt;
  }
  return next;
}

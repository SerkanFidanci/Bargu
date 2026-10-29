import type { Circle } from '@bargu/schemas';

import { type CircleSharing, circleSharing, type SharingSettings } from './sharing';

/**
 * What a friend gets of the user's location (docs/ADR/0038): shown with no end, shown until a
 * time, frozen (the last location stays, nothing new goes, and they are not told), or not shown.
 */
export type PersonShareMode = 'always' | 'until' | 'frozen' | 'off';

export type PersonShareChoice =
  { mode: 'always' } | { mode: 'until'; until: number } | { mode: 'frozen' } | { mode: 'off' };

/** "21:30" in the user's language. */
export function clockOf(at: number, language: string): string {
  return new Date(at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}

const HALF_HOUR_MS = 30 * 60_000;
/** The times "… kadar" offers: every half hour for six hours. */
export const UNTIL_CHOICES = 12;

/** What the friendship gets now, as the card and its sheet say it. */
export function personShareOf(
  settings: SharingSettings,
  circleId: string,
  now: number,
): { mode: PersonShareMode; until: number | null } {
  const sharing = circleSharing(settings, circleId);
  if (!sharing.sharing || (sharing.until !== null && sharing.until <= now)) {
    return { mode: 'off', until: null };
  }
  if (sharing.frozen === true) return { mode: 'frozen', until: sharing.until };
  return sharing.until === null
    ? { mode: 'always', until: null }
    : { mode: 'until', until: sharing.until };
}

/** The friendship's sharing as chosen; how precise and the history stay as they were. */
export function withPersonShare(
  settings: SharingSettings,
  circleId: string,
  choice: PersonShareChoice,
): SharingSettings {
  const current = circleSharing(settings, circleId);
  const kept: CircleSharing = {
    sharing: current.sharing,
    precision: current.precision,
    until: current.until,
    ...(current.history === undefined ? {} : { history: current.history }),
  };
  const next: CircleSharing =
    choice.mode === 'off'
      ? { ...kept, sharing: false, until: null }
      : choice.mode === 'always'
        ? { ...kept, sharing: true, until: null }
        : choice.mode === 'until'
          ? { ...kept, sharing: true, until: choice.until }
          : { ...kept, sharing: true, until: null, frozen: true };
  return { ...settings, circles: { ...settings.circles, [circleId]: next } };
}

/**
 * The ends "… kadar" offers (the PM's "21:30'a kadar"): the half hours from at least half an hour
 * from now, for six hours.
 */
export function untilChoices(now: number): number[] {
  const first = Math.ceil((now + HALF_HOUR_MS) / HALF_HOUR_MS) * HALF_HOUR_MS;
  return Array.from({ length: UNTIL_CHOICES }, (_, index) => first + index * HALF_HOUR_MS);
}

/** "1 saat daha": what one tap on the line at the end shares again (docs/ADR/0038). */
export const SHARE_AGAIN_MS = 60 * 60_000;

/**
 * Friendships whose timed share ran out after `since` and by `now` (docs/ADR/0038, the PM: the
 * friend goes from the map, and the user is told so in one line). A ghost ends nothing of this.
 */
export function endedFriendShares(
  settings: SharingSettings,
  circles: readonly Circle[],
  since: number,
  now: number,
): Circle[] {
  if (settings.ghost !== 'off') return [];
  return circles.filter((circle) => {
    if (circle.kind !== 'pair' || circle.myStatus !== 'active') return false;
    const sharing = circleSharing(settings, circle.id);
    return (
      sharing.sharing && sharing.until !== null && sharing.until > since && sharing.until <= now
    );
  });
}

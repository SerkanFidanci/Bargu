import type { TFunction } from 'i18next';

import { endClock } from '../circles/event-ui';

const HOUR_MS = 3600_000;

/**
 * An arrival as people say it, never more exact than it is (Ö12, the PM 2026-10-29): "Yaklaşık
 * 4 dk" within the hour, "Yaklaşık 21:35" later, with how late when it is.
 */
export function etaWords(
  t: TFunction,
  arrival: { at: number; late: number },
  now: number,
  language: string,
): string {
  const ahead = arrival.at - now;
  const when =
    ahead <= HOUR_MS
      ? t('plan.etaIn', { minutes: Math.max(1, Math.round(ahead / 60_000)) })
      : t('plan.eta', { time: endClock(arrival.at, now, language) });
  return arrival.late > 0 ? t('plan.etaLate', { when, minutes: arrival.late }) : when;
}

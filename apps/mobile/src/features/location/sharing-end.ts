import { useEffect, useRef, useState } from 'react';

import { catchUp, timerAt } from './clock';
import { type SharingSettings, useSharing } from './sharing';

/** When the earliest timed share still running ends, or null when none is timed. */
export function nextSharingEnd(settings: SharingSettings, now: number): number | null {
  const ends = Object.values(settings.circles)
    .map((circle) => circle.until)
    .filter((until): until is number => until !== null && until > now);
  return ends.length === 0 ? null : Math.min(...ends);
}

/**
 * One timer for the earliest timed share's end (QA 24 B-2): right then the shared clock catches up,
 * so "who sees me" and the ghost button's dot stop saying "shared" at the same moment the location
 * engine (`onEnd`) stops sending. Not polling: one timer (in steps when weeks away), set again when
 * the sharing changes.
 * Re-renders its user at that moment.
 */
export function useSharingEnd(onEnd: () => void): number {
  const sharing = useSharing();
  const [tick, setTick] = useState(0);
  const ended = useRef(onEnd);
  useEffect(() => {
    ended.current = onEnd;
  });
  useEffect(() => {
    const now = Date.now();
    const end = nextSharingEnd(sharing, now);
    if (end === null) return;
    // In steps when it is weeks away: a timer past about 24.8 days would fire at once (QA 25).
    return timerAt(end + 1, () => {
      catchUp();
      ended.current();
      setTick((value) => value + 1);
    });
  }, [sharing, tick]);
  return tick;
}

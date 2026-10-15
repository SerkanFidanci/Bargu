import { EVENT_DURATION_MS } from '@bargu/schemas';

import { endedEvents, eventEndAt, nextEventEnd, remainingShare, timeLeft } from './event-time';

const HOUR = 3600_000;

describe('event times', () => {
  // 14:00 local time on some day.
  const afternoon = new Date(2026, 9, 15, 14, 0, 0).getTime();

  it('offers ends from an hour to a week, within what the server accepts', () => {
    expect(eventEndAt('hours1', afternoon)).toBe(afternoon + HOUR);
    expect(eventEndAt('hours3', afternoon)).toBe(afternoon + 3 * HOUR);
    expect(new Date(eventEndAt('tonight', afternoon) ?? 0).getHours()).toBe(23);
    expect(eventEndAt('tomorrow', afternoon)).toBeGreaterThan(afternoon + 24 * HOUR);
    const week = eventEndAt('week', afternoon) ?? 0;
    expect(week - afternoon).toBeLessThanOrEqual(EVENT_DURATION_MS.max);
  });

  it('does not offer "tonight" when the night is almost over', () => {
    const late = new Date(2026, 9, 15, 23, 50, 0).getTime();
    expect(eventEndAt('tonight', late)).toBeNull();
    expect(eventEndAt('hours1', late)).not.toBeNull();
  });

  it('counts down in hours and minutes, rounding up', () => {
    expect(timeLeft(afternoon + 2 * HOUR + 14 * 60_000, afternoon)).toEqual({
      hours: 2,
      minutes: 14,
    });
    expect(timeLeft(afternoon + 1_000, afternoon)).toEqual({ hours: 0, minutes: 1 });
    expect(timeLeft(afternoon - 1_000, afternoon)).toEqual({ hours: 0, minutes: 0 });
  });

  it('fills the ring by the share of the event still ahead', () => {
    expect(remainingShare(0, 100, 0)).toBe(1);
    expect(remainingShare(0, 100, 75)).toBe(0.25);
    expect(remainingShare(0, 100, 150)).toBe(0);
    expect(remainingShare(100, 100, 50)).toBe(0);
  });

  it('finds the events that ended and the next one to end', () => {
    const circles = [
      { id: 'group' },
      { id: 'over', expiresAt: afternoon - 1 },
      { id: 'soon', expiresAt: afternoon + HOUR },
      { id: 'later', expiresAt: afternoon + 5 * HOUR },
    ];
    expect(endedEvents(circles, afternoon)).toEqual(['over']);
    expect(nextEventEnd(circles, afternoon)).toBe(afternoon + HOUR);
    expect(nextEventEnd([{}], afternoon)).toBeNull();
  });
});

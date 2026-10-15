import type { GuardianRules } from '@bargu/schemas';

import {
  addOpen,
  dailyLimit,
  loadRules,
  localDay,
  minutesToday,
  RULES_KEY,
  saveRules,
  timeIsUp,
} from './screen-time';

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();
const linked = (dailyLimitMinutes: number | null): GuardianRules => ({
  linked: true,
  settings: { approveNewPeople: true, dailyLimitMinutes },
});

describe('screen time (docs/ADR/0023 §5)', () => {
  it('adds the minutes the app is open, starting over on a new day of the phone', () => {
    const morning = addOpen({ day: localDay(at(16, 0)), ms: 0 }, at(16, 9), at(16, 9, 20));
    expect(minutesToday(morning, at(16, 10))).toBe(20);
    const later = addOpen(morning, at(16, 18), at(16, 18, 25));
    expect(minutesToday(later, at(16, 19))).toBe(45);
    // The next day counts from nothing, and yesterday says nothing about today.
    expect(minutesToday(later, at(17, 8))).toBe(0);
    // Open across midnight: only the part after it counts for the new day.
    const night = addOpen(later, at(16, 23, 50), at(17, 0, 15));
    expect(night.day).toBe(localDay(at(17, 1)));
    expect(minutesToday(night, at(17, 1))).toBe(15);
    expect(addOpen(night, at(17, 2), at(17, 2))).toBe(night);
  });

  it("closes the app only at a parent's limit, while a parent is linked", () => {
    const count = { day: localDay(at(16, 12)), ms: 61 * 60_000 };
    expect(timeIsUp(linked(60), count, at(16, 12))).toBe(true);
    expect(timeIsUp(linked(90), count, at(16, 12))).toBe(false);
    expect(timeIsUp(linked(null), count, at(16, 12))).toBe(false);
    expect(timeIsUp({ linked: false, settings: null }, count, at(16, 12))).toBe(false);
    expect(timeIsUp(null, count, at(16, 12))).toBe(false);
    // The next day it opens again.
    expect(timeIsUp(linked(60), count, at(17, 8))).toBe(false);
    expect(dailyLimit(linked(120))).toBe(120);
  });

  it('keeps the last rules on the phone, so a start offline still has the limit (QA 5c F-1)', () => {
    const kept = new Map<string, string>();
    const store = {
      get: (key: string) => kept.get(key),
      set: (key: string, value: string) => kept.set(key, value),
      delete: (key: string) => kept.delete(key),
      keys: () => [...kept.keys()],
      clear: () => {
        kept.clear();
      },
    };
    expect(loadRules(store)).toBeNull();
    saveRules(store, linked(30));
    expect(loadRules(store)).toEqual(linked(30));
    kept.set(RULES_KEY, '{not json');
    expect(loadRules(store)).toBeNull();
  });
});

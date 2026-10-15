import { type GuardianRules, guardianRulesSchema } from '@bargu/schemas';

import type { KeyValueStore } from '../storage/vault';

/**
 * The last rules the server gave, kept on the phone (encrypted vault, QA 5c F-1): an app started
 * offline still counts the minutes and closes at the limit.
 */
export const RULES_KEY = 'screen-time:rules:v1';

export function loadRules(store: KeyValueStore): GuardianRules | null {
  const raw = store.get(RULES_KEY);
  if (raw === undefined) return null;
  try {
    const parsed = guardianRulesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveRules(store: KeyValueStore, rules: GuardianRules): void {
  store.set(RULES_KEY, JSON.stringify(rules));
}

/** How long the app was open on one day of the phone's calendar (docs/ADR/0023 §5). */
export interface ScreenTime {
  /** The phone's own calendar day, YYYY-MM-DD. */
  day: string;
  ms: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The phone's calendar day of a moment, YYYY-MM-DD. */
export function localDay(at: number): string {
  const date = new Date(at);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Counts a stretch the app was open, from `from` to `to`. A new day starts the count over; a
 * stretch across midnight counts for the new day only from midnight.
 */
export function addOpen(count: ScreenTime, from: number, to: number): ScreenTime {
  if (to <= from) return count;
  const day = localDay(to);
  if (day === count.day) return { day, ms: count.ms + (to - from) };
  return { day, ms: to - Math.max(from, startOfDay(to)) };
}

/** Whole minutes open today (0 when the count is from another day). */
export function minutesToday(count: ScreenTime, now: number): number {
  return count.day === localDay(now) ? Math.floor(count.ms / 60_000) : 0;
}

/** The daily limit a parent set, while a parent is linked; null: none. */
export function dailyLimit(rules: GuardianRules | null): number | null {
  return rules?.linked === true ? (rules.settings?.dailyLimitMinutes ?? null) : null;
}

/** Whether the app is closed for the rest of the day. */
export function timeIsUp(rules: GuardianRules | null, count: ScreenTime, now: number): boolean {
  const limit = dailyLimit(rules);
  return limit !== null && minutesToday(count, now) >= limit;
}

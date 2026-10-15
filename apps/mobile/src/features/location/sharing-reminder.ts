import type { Circle } from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyValueStore } from '../storage/vault';

/**
 * "Konumunu kimler görüyor?" every week (BARGU_PLAN Faz 9, §2: periodic reminder against hidden
 * tracking): a card on the map and a notification this phone sets itself (nothing about it goes
 * to the server or a push service). Only while someone sees the location or its history.
 */
export const SHARING_REMINDER_EVERY_MS = 7 * 24 * 3600 * 1000;

const KEY = 'sharing:reminder:v1';
const reviewSchema = z.object({ reviewedAt: z.number() }).strict();

/** When the user last looked (null: never counted yet, e.g. right after installing). */
export const useSharingReminder = create<{ reviewedAt: number | null }>(() => ({
  reviewedAt: null,
}));

export function lastReview(store: KeyValueStore): number | null {
  const raw = store.get(KEY);
  if (raw === undefined) return null;
  const parsed = reviewSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data.reviewedAt : null;
}

export function saveReview(store: KeyValueStore, reviewedAt: number): void {
  store.set(KEY, JSON.stringify({ reviewedAt }));
  useSharingReminder.setState({ reviewedAt }, true);
}

/** When the next reminder is due, counted from the last look. */
export const reminderAt = (reviewedAt: number) => reviewedAt + SHARING_REMINDER_EVERY_MS;

export function reminderDue(reviewedAt: number | null, now: number): boolean {
  return reviewedAt !== null && now >= reminderAt(reviewedAt);
}

/** What the card says: how many see the location, circle by circle, and how many the history. */
export interface ReminderSummary {
  people: number;
  circles: { circleId: string; name: string; count: number }[];
  historyPeople: number;
}

export function reminderSummary(
  seen: readonly { circle: Circle; seers: readonly { userId: string }[] }[],
  history: readonly { viewers: readonly { userId: string }[] }[],
  nameOf: (circle: Circle) => string,
): ReminderSummary {
  return {
    people: new Set(seen.flatMap(({ seers }) => seers.map((member) => member.userId))).size,
    circles: seen.map(({ circle, seers }) => ({
      circleId: circle.id,
      name: nameOf(circle),
      count: seers.length,
    })),
    historyPeople: new Set(history.flatMap(({ viewers }) => viewers.map((member) => member.userId)))
      .size,
  };
}

/** Whether there is anything to remind of: nobody sees anything, nothing to say. */
export const anyoneSees = (summary: ReminderSummary) =>
  summary.people > 0 || summary.historyPeople > 0;

import type { GuardianRules } from '@bargu/schemas';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import { create } from 'zustand';

import { onSignedOut } from '../auth/auth-store';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { guardianRulesKey, guardiansApi } from './guardians-api';
import { addOpen, localDay, minutesToday, type ScreenTime, timeIsUp } from './screen-time';

/** Kept on this phone (encrypted vault): today's minutes, so a restart does not reset them. */
const SCREEN_TIME_KEY = 'screen-time:v1';
/** How often the count moves on while the app is open (the limit is checked as it does). */
const TICK_MS = 30_000;
/** At most this often the minutes go to the server while the app stays open. */
const REPORT_EVERY_MS = 15 * 60_000;

const storedSchema = z.object({ day: z.string(), ms: z.number().nonnegative() }).strict();

/**
 * Screen time of a 15-17 child whose parent is linked (docs/ADR/0023 §5): the phone counts the
 * minutes the app is open, sends the day's total to the server (the parents see it), and closes the
 * app for the rest of the day when a parent's daily limit is reached. The location keeps going.
 */
export const useScreenTime = create<{
  count: ScreenTime;
  rules: GuardianRules | null;
  /** Now, as of the last tick: re-renders the gate when the day changes too. */
  now: number;
}>(() => ({ count: { day: '', ms: 0 }, rules: null, now: Date.now() }));

let openedAt: number | null = null;
let reportedAt = 0;
let started = false;

function load(): ScreenTime {
  const raw = vault().get(SCREEN_TIME_KEY);
  if (raw === undefined) return { day: localDay(Date.now()), ms: 0 };
  const parsed = storedSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : { day: localDay(Date.now()), ms: 0 };
}

/** Moves the count on to now (only while open and a parent is linked), and keeps it. */
function tick(now: number): void {
  const { count, rules } = useScreenTime.getState();
  let next = count;
  if (openedAt !== null && rules?.linked === true) next = addOpen(count, openedAt, now);
  if (openedAt !== null) openedAt = now;
  useScreenTime.setState({ count: next, now });
  if (next !== count && isVaultOpen()) vault().set(SCREEN_TIME_KEY, JSON.stringify(next));
}

/** The day's minutes to the server, when a parent is linked; a failure waits for the next time. */
async function report(now: number): Promise<void> {
  const { count, rules } = useScreenTime.getState();
  if (rules?.linked !== true || count.day !== localDay(now)) return;
  reportedAt = now;
  try {
    await guardiansApi.reportUsage({ day: count.day, minutes: minutesToday(count, now) });
  } catch {
    // Offline: the next report carries the day's total anyway.
  }
}

/** The child's rules as the server has them now (a parent changed them, or a link came or went). */
export async function refreshRules(): Promise<void> {
  try {
    const rules = await queryClient.query({
      queryKey: guardianRulesKey,
      queryFn: () => guardiansApi.rules(),
      staleTime: 0,
    });
    useScreenTime.setState({ rules });
  } catch {
    // Offline: the rules known so far stay.
  }
}

function start(): void {
  if (started) return;
  started = true;
  useScreenTime.setState({ count: load(), now: Date.now() });
  if (AppState.currentState === 'active') openedAt = Date.now();
  void refreshRules();
  AppState.addEventListener('change', (state) => {
    const now = Date.now();
    if (state === 'active') {
      openedAt = now;
      useScreenTime.setState({ now });
      void refreshRules();
      return;
    }
    tick(now);
    openedAt = null;
    void report(now);
  });
  setInterval(() => {
    if (openedAt === null || !isVaultOpen()) return;
    const now = Date.now();
    tick(now);
    if (now - reportedAt >= REPORT_EVERY_MS) void report(now);
  }, TICK_MS);
}

onSignedOut(() => {
  useScreenTime.setState({ count: { day: '', ms: 0 }, rules: null });
});

/** Starts counting once the vault is open; true while the app is closed for the day. */
export function useTimeUp(ready: boolean): boolean {
  useEffect(() => {
    if (ready) start();
  }, [ready]);
  return useScreenTime((state) => ready && timeIsUp(state.rules, state.count, state.now));
}

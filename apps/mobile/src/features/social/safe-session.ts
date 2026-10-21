import type { Circle, SafePayload } from '@bargu/schemas';
import * as Battery from 'expo-battery';
import { create } from 'zustand';

import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import { ApiError } from '../auth/api-client';
import { api, onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { circleSync, keys } from '../live/live-session';
import { useMyFix } from '../location/engine';
import { useSharing } from '../location/sharing';
import { currentFix, lastKnownFix } from '../location/tracker';
import { loadContacts } from '../notifications/push-contacts';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { createSafeCheckIns, loadChoice, receiveSafe, type SafeFix } from './safe';
import { loadSpots, resetSpot, showSpot } from './safe-spot';

/** How many "Güvendeyim" messages wait for a connection (the sheet says so). */
export const useSafeWaiting = create<{ count: number }>(() => ({ count: 0 }));

/** A position the engine took this recently is used as it is. */
const FRESH_FIX_MS = 2 * 60_000;
/** How long the phone gets to find one position for the message. */
const ONE_SHOT_MS = 8_000;
/** Failing that, a position this old still says more than nothing. */
const STALE_FIX_MS = 15 * 60_000;

function cachedCircles(): readonly Circle[] {
  return queryClient.getQueryData<Circle[]>(circlesKey) ?? [];
}

/** Where this phone is for a message: the engine's position, a fresh one-off, or the last known. */
async function position(): Promise<SafeFix | null> {
  const now = Date.now();
  const known = useMyFix.getState().fix;
  if (known !== null && now - known.ts <= FRESH_FIX_MS) return known;
  const fresh = await currentFix(ONE_SHOT_MS);
  if (fresh !== null) return fresh;
  if (known !== null && now - known.ts <= STALE_FIX_MS) return known;
  const last = await lastKnownFix().catch(() => null);
  return last !== null && now - last.ts <= STALE_FIX_MS ? last : null;
}

/** 0-100; the platform reports -1 where it cannot know (emulators): "full" rather than "empty". */
async function batteryPercent(): Promise<number> {
  const state = await Battery.getPowerStateAsync();
  return state.batteryLevel < 0 ? 100 : state.batteryLevel * 100;
}

/**
 * The phone's "Güvendeyim" (docs/ADR/0029): `tell` for the sheet, `flush` when the connection
 * returns. Messages that cannot go wait in the encrypted vault (safe.ts).
 */
export const safeCheckIns = createSafeCheckIns({
  store: vault,
  keys,
  device: () => useAuth.getState().device,
  circles: cachedCircles,
  recipients: (circleId) => loadContacts(vault()).recipients[circleId] ?? [],
  sharing: () => useSharing.getState(),
  fix: position,
  battery: batteryPercent,
  send: (request) => api.authed('/v1/safe', { method: 'POST', body: request }),
  // A request the server calls bad, or a circle it does not know: asking again changes nothing.
  permanent: (error) => error instanceof ApiError && (error.status === 400 || error.status === 404),
  refresh: (circleId) => circleSync.refresh(circleId),
  onWaiting: (count) => {
    useSafeWaiting.setState({ count });
  },
});

/** The circles ticked last time ("Güvendeyim" remembers them), if the phone has any memory. */
export function rememberedChoice(): string[] | null {
  return isVaultOpen() ? loadChoice(vault()) : null;
}

/** The app starting: what waits to be sent is counted, and the places a day old are deleted. */
export function restoreSafe(): void {
  safeCheckIns.restore();
  loadSpots(vault(), Date.now());
}

/**
 * Someone told this circle they are safe, and this phone is open: a line with who, the battery
 * and (when it came late) the time; tapping it shows their place on Bargu's own map, at the
 * precision they chose for this circle (a dot, or a circle with its accuracy). Once per message,
 * however it came.
 */
export function receivedSafe(circleId: string, userId: string, safe: SafePayload): void {
  const shown = receiveSafe({
    store: vault(),
    circles: cachedCircles(),
    circleId,
    userId,
    safe,
    now: Date.now(),
  });
  if (shown === null) return;
  feedback('success');
  toast.notice(shown.text, 'success', () => {
    showSpot(shown.spot);
  });
}

onSignedOut(() => {
  safeCheckIns.reset();
  resetSpot();
});

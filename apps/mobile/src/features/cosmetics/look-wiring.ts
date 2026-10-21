import { hashKey } from '@tanstack/react-query';
import { useEffect } from 'react';

import { onSignedOut } from '../auth/auth-store';
import { planKey } from '../billing/plan';
import { circlesKey } from '../circles/circle-cache';
import { useCircleKeys } from '../circles/circle-sync';
import { onOnline, onServerEvents } from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen } from '../storage/vault';
import { publishLook, refreshPass, resetLooks, restoreLooks } from './look-session';

/**
 * What keeps the looks current (docs/ADR/0025), by events and never by polling: the own pass is
 * renewed when the app opens, when the plan changes, when the plan says there is a pack the pass
 * lacks, and when the connection is back; the look goes to circles wherever the profile goes (a
 * new member or epoch in the circle list, a new phone or trust given in the keys).
 */
const quietly = (work: Promise<void>) => {
  work.catch(() => undefined);
};

const PLAN_HASH = hashKey(planKey);
const CIRCLES_HASH = hashKey(circlesKey);

onServerEvents((events) => {
  if (events.some((event) => event.type === 'plan.changed')) quietly(refreshPass());
});
onOnline(() => {
  quietly(refreshPass());
});
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated') return;
  if (event.query.queryHash === PLAN_HASH) quietly(refreshPass());
  // New members and new epochs: they could not read the look sent before.
  if (event.query.queryHash === CIRCLES_HASH && isVaultOpen()) quietly(publishLook());
});
// A member's new phone, or a key change the user accepted: the look is due to them (after TOFU).
useCircleKeys.subscribe(() => {
  if (isVaultOpen()) quietly(publishLook());
});
onSignedOut(resetLooks);

/**
 * With the vault open: the choice, the pass and others' looks from before, then the pass checked
 * for renewal (less than half of its life left) and the look told to circles that lack it.
 */
export function useLookSession(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    restoreLooks();
    quietly(refreshPass().then(publishLook));
  }, [ready]);
}

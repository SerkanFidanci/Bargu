import type { Plan } from '@bargu/schemas';
import { AppState } from 'react-native';

import { onSignedOut } from '../../auth/auth-store';
import { planKey } from '../../billing/plan';
import { queryClient } from '../../query-client';
import { isVaultOpen, vault } from '../../storage/vault';
import { createMonthFiles, forgetTrailKey, prepareTrailKey, trailKeyReady } from './own-files';
import { createOwnTrail } from './own-trail';

/**
 * One's own history on this phone (docs/ADR/0030): the store, the entitlement the recording asks
 * for, and the turns that keep it tidy (compacting a finished day, forgetting an old one).
 */
const files = createMonthFiles(() => vault());

export const ownTrail = createOwnTrail({
  vault: () => vault(),
  files,
  unlocked: trailKeyReady,
});

const ENTITLED_KEY = 'own:entitled:v1';
const DAY_MS = 24 * 3_600_000;

/**
 * Whether the plan runs now, kept in the vault: a position that comes while the app is closed has
 * no query cache to ask. It lasts until the plan's end (a payment in grace as long as that).
 */
export function rememberEntitlement(plan: Plan | undefined): void {
  if (plan === undefined || !isVaultOpen()) return;
  const ends = [plan.expiresAt, plan.graceUntil, plan.plan === 'trial' ? plan.trialEndsAt : null]
    .filter((at): at is number => at !== null)
    .sort((a, b) => b - a)[0];
  const until = plan.plan === 'free' ? 0 : (ends ?? null);
  vault().set(ENTITLED_KEY, JSON.stringify({ until }));
}

/** Whether the recording is entitled now (Bargu+ or its trial): false when it is not known. */
export function ownEntitled(now: number): boolean {
  if (!isVaultOpen()) return false;
  const raw = vault().get(ENTITLED_KEY);
  if (raw === undefined) return false;
  try {
    const parsed = JSON.parse(raw) as { until?: number | null };
    return parsed.until === null || (typeof parsed.until === 'number' && now <= parsed.until);
  } catch {
    return false;
  }
}

const LAST_TICK_KEY = 'own:tick:v1';

/**
 * The turn that keeps the history tidy: reads the files' key (creating it when the history is on),
 * compacts the days that are over, and once a day forgets the old ones. With the phone locked
 * nothing happens and the points keep waiting. Cheap when there is nothing to do.
 */
export async function ownTrailTick(now = Date.now()): Promise<void> {
  if (!isVaultOpen()) return;
  const on = ownTrail.settings().on;
  if (!on && ownTrail.days().length === 0) return;
  if (!(await prepareTrailKey(on))) return;
  ownTrail.compact();
  const last = Number(vault().get(LAST_TICK_KEY) ?? 0);
  if (now - last >= DAY_MS) {
    ownTrail.prune();
    vault().set(LAST_TICK_KEY, String(now));
  }
}

// The plan arrives or changes: remember whether it carries the history.
const PLAN_HASH = JSON.stringify(planKey);
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== PLAN_HASH || event.type !== 'updated') return;
  rememberEntitlement(queryClient.getQueryData<Plan>(planKey));
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') void ownTrailTick().catch(() => undefined);
  // Locked or sent away: the files' key is forgotten from memory, read again when it is needed.
  if (state === 'background') forgetTrailKey();
});

// Nothing of one account may survive into the next sign-in: the files and their key go.
onSignedOut(() => {
  try {
    ownTrail.clear();
  } catch {
    // The vault is closed already: the files are still deleted (own-files.ts).
    files.destroy();
  }
});

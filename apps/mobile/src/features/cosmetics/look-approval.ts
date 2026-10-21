import type { CosmeticPack, Plan } from '@bargu/schemas';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { chooseLook, refreshPass, useMyLook } from './look-session';
import { PACK_PART, PACKS } from './look-styles';
import { stopTrying, useTrying } from './look-trying';

/**
 * A 15-17 account asks a parent for a pack (docs/ADR/0025, slice 3c); the plan says it waits
 * (`pendingCosmetics`). When a later plan has the pack, the parent said yes: this says so, and the
 * style tried from the pack meanwhile, which was the user's choice, is chosen and sent to circles
 * with the new pass, as after a purchase. It runs from the plan in the query cache, which the
 * server's `plan.changed` keeps current (look-wiring.ts): no polling, no screen needed.
 */

/** The packs the earlier plan had waiting for a parent that this plan has: a parent said yes. */
export function approvedPacks(before: Plan | undefined, after: Plan): CosmeticPack[] {
  const waiting = before?.pendingCosmetics ?? [];
  return PACKS.filter((pack) => waiting.includes(pack) && after.cosmetics.includes(pack));
}

async function approved(pack: CosmeticPack): Promise<void> {
  toast.success(i18n.t('cosmetics.approved', { pack: i18n.t(`cosmetics.packs.${pack}.name`) }));
  const part = PACK_PART[pack];
  const tried = useTrying.getState()[part];
  stopTrying(part);
  // The new pack is in the next pass. A pass that cannot be had now (offline) does not undo the
  // choice: it is kept, and shows once the pass has the pack.
  await refreshPass(true).catch(() => undefined);
  if (typeof tried === 'string') {
    await chooseLook({ ...useMyLook.getState().choice, [part]: tried });
  }
}

/** The plan last seen: what the next one is compared with. */
let last: Plan | undefined;

/** A plan arrived (the query cache's, whatever brought it): a pack a parent said yes to is opened. */
export function planSeen(plan: Plan): void {
  const packs = approvedPacks(last, plan);
  last = plan;
  for (const pack of packs) approved(pack).catch(() => undefined);
}

/** Signed out: the next account's plan is compared with nothing. */
export function resetApproval(): void {
  last = undefined;
}

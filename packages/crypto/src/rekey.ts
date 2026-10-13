import { REKEY_INTERVAL_MS } from './constants.js';

export type RekeyReason =
  'membership-changed' | 'device-changed' | 'interval-elapsed' | 'state-lost';

/**
 * When a circle must move to a new epoch (new sender keys for everyone): member added or removed,
 * a member changed device, 24 hours passed, or a sender lost its sequence state. Returns the first
 * applicable reason, or `null`.
 */
export function rekeyReason(input: {
  epochStartedAt: number;
  now: number;
  membershipChanged?: boolean;
  deviceChanged?: boolean;
  senderStateLost?: boolean;
}): RekeyReason | null {
  if (input.membershipChanged === true) return 'membership-changed';
  if (input.deviceChanged === true) return 'device-changed';
  if (input.senderStateLost === true) return 'state-lost';
  if (input.now - input.epochStartedAt >= REKEY_INTERVAL_MS) return 'interval-elapsed';
  return null;
}

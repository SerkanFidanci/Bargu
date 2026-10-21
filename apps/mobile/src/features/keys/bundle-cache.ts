import { type DevicePublicKeys, verifyDeviceKeyBundle } from '@bargu/crypto';
import type { DeviceKeyBundle } from '@bargu/schemas';

/**
 * How many checked bundles are kept: one per phone this phone hears from, with room to spare. A
 * member's bundle changes only with a new phone, which is a different entry.
 */
const KEEP = 256;

const checked = new Map<string, DevicePublicKeys>();

/**
 * `verifyDeviceKeyBundle`, remembered. The check (a valid identity key, the DH key signed by it)
 * gives the same answer every time for the same bundle, and the identity key's part is pure
 * JavaScript curve arithmetic, slow on Hermes (docs/ADR/0007): it was repeated for every location,
 * status and stored place that came in, and for every member at every key sync. A bundle that
 * fails the check throws, as it does there, and is never remembered. The key is every field the
 * check reads, so a changed bundle is never taken for one already checked.
 */
export function verifiedBundle(bundle: DeviceKeyBundle): DevicePublicKeys {
  const id = `${bundle.deviceId}|${bundle.identityKey}|${bundle.dhKey}|${bundle.dhKeySignature}`;
  const known = checked.get(id);
  if (known !== undefined) return known;
  const keys = verifyDeviceKeyBundle(bundle);
  if (checked.size >= KEEP) {
    const oldest = checked.keys().next().value;
    if (oldest !== undefined) checked.delete(oldest);
  }
  checked.set(id, keys);
  return keys;
}

/** Sign-out and tests: nothing of one account carries over. */
export function forgetCheckedBundles(): void {
  checked.clear();
}

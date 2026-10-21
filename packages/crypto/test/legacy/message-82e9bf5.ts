// The opening code of an app built before the `state` message ("Neden eski?", docs/ADR/0028):
// packages/crypto/src/message.ts `decryptMessage` as of commit 82e9bf5 (with the payload union of
// that commit, see below), verbatim but for the import paths, which point at today's building
// blocks (envelope schema, header, padding, primitives: unchanged by that slice, only added to).
// legacy-app.spec.ts runs it against the new `state` messages.
import { messageEnvelopeSchema, payloadSchema, type Payload } from '@bargu/schemas';

import { LABELS, PROTOCOL_VERSION, SALT_BYTES, SIGNATURE_BYTES } from '../../src/constants.js';
import { concatBytes, fromBase64url, u32be, utf8Decode, uuidToBytes } from '../../src/encoding.js';
import { BarguCryptoError } from '../../src/errors.js';
import type { DevicePublicKeys } from '../../src/keys.js';
import { unpad } from '../../src/padding.js';
import { aeadOpen, deriveKeyAndNonce, verifyWithLabel } from '../../src/primitives.js';
import type { ReplayGuard } from '../../src/replay.js';
import type { SenderKey } from '../../src/sender-key.js';

/**
 * The kinds at 82e9bf5: every kind today but `state` and `safe` (Güvendeyim came after it). Their
 * schemas are unchanged since, so the union of that commit is today's union restricted to these
 * (packages/crypto has no zod of its own to rebuild it with).
 */
const KINDS_AT_82E9BF5: readonly string[] = [
  'loc',
  'bump',
  'place_enter',
  'place_exit',
  'share_stop',
  'status',
  'profile',
  'place',
  'late',
  'look',
  'arrived',
];

export function decryptMessageAt82e9bf5(input: {
  envelope: unknown;
  senderKey: SenderKey;
  sender: DevicePublicKeys;
  replay: ReplayGuard;
}): Payload {
  const { senderKey, sender, replay } = input;
  const parsed = messageEnvelopeSchema.safeParse(input.envelope);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid envelope');
  const data = parsed.data;
  const salt = fromBase64url(data.salt, SALT_BYTES);
  const ct = fromBase64url(data.ct);
  const sig = fromBase64url(data.sig, SIGNATURE_BYTES);
  const header = concatBytes(
    Uint8Array.of(PROTOCOL_VERSION),
    uuidToBytes(data.circleId),
    u32be(data.epoch),
    uuidToBytes(data.senderDeviceId),
    u32be(data.seq),
    salt,
  );
  if (data.senderDeviceId !== sender.deviceId || data.senderDeviceId !== senderKey.senderDeviceId) {
    throw new BarguCryptoError('KEY_MISMATCH', 'envelope is from another device');
  }
  if (data.circleId !== senderKey.circleId || data.epoch !== senderKey.epoch) {
    throw new BarguCryptoError('KEY_MISMATCH', 'envelope uses another circle or epoch');
  }
  if (!verifyWithLabel(LABELS.messageSignature, concatBytes(header, ct), sig, sender.identityKey)) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'invalid envelope signature');
  }
  const verdict = replay.check(data.circleId, data.senderDeviceId, data.epoch, data.seq);
  if (verdict === 'replay') {
    throw new BarguCryptoError('REPLAY', 'message already seen or too old');
  }
  const keyAndNonce = deriveKeyAndNonce(senderKey.key, salt, LABELS.messageKdf, header);
  const padded = aeadOpen(keyAndNonce, ct, header);
  let json: unknown;
  try {
    json = JSON.parse(utf8Decode(unpad(padded, padded.length)));
  } catch {
    throw new BarguCryptoError('MALFORMED', 'payload is not valid JSON');
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success || !KINDS_AT_82E9BF5.includes(payload.data.kind)) {
    throw new BarguCryptoError('MALFORMED', 'invalid payload');
  }
  replay.accept(data.circleId, data.senderDeviceId, data.epoch, data.seq);
  if (payload.data.kind === 'loc' && verdict !== 'latest') {
    throw new BarguCryptoError('STALE', 'a newer location from this sender was already accepted');
  }
  return payload.data;
}

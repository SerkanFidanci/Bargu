import { PUSH_NOTICES, pushBodySchema, type PushBody } from '@bargu/schemas';
import { describe, expect, it } from 'vitest';

import { BarguCryptoError } from '../src/errors.js';
import { randomBytes } from '../src/primitives.js';
import { openPush, sealPush } from '../src/push.js';
import {
  type BodySchema,
  openPush as openPushAt028ab2e,
  openPushWith,
} from './legacy/push-028ab2e.js';
import { ids, testDevice } from './helpers.js';

// QA-28 B-1, the rollout: the server signs its notices as soon as it has a notice key, while apps
// built before (028ab2e and older) are still installed. What does such an app do with one?
const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const toBob = { deviceId: bob.deviceId, dhKey: bob.dh.publicKey };
const signer = { secretKey: randomBytes(32), kid: 'stg-n1' };
const NOW = 1_800_000_000_000;
const known = (deviceId: string) => (deviceId === alice.deviceId ? alice.identity.publicKey : null);
const oldApp = (sealed: string) =>
  openPushAt028ab2e({ recipient: bob, sealed, senderIdentityKey: known });

/** What the old app's opening code throws, or 'opened'. */
function outcome(sealed: string): string {
  try {
    oldApp(sealed);
    return 'opened';
  } catch (error) {
    // Anything but a BarguCryptoError would be a crash risk worth knowing about.
    return error instanceof BarguCryptoError ? error.code : 'UNEXPECTED';
  }
}

describe('an app from before signed server notices (028ab2e)', () => {
  it.each(PUSH_NOTICES)(
    'drops a signed %s silently: its own "invalid push" error, which it already catches',
    (notice) => {
      const body: PushBody = { kind: 'notice', notice, circleId: ids.circle, ts: NOW };
      const signed = sealPush({ recipient: toBob, sender: null, body, signer });
      // The old opening code does not know the first byte 0x02: MALFORMED, like any box it cannot
      // read. Its caller (apps/mobile background-push.ts, the same file today) turns every
      // openPush error into 'refused': nothing shown, nothing done, nothing logged.
      expect(outcome(signed)).toBe('MALFORMED');
      // The new code opens the very same box.
      expect(openPush({ recipient: bob, sealed: signed, senderIdentityKey: known }).body).toEqual(
        body,
      );
    },
  );

  it('keeps opening what it opened before: unsigned notices and members’ pushes', () => {
    const notice: PushBody = {
      kind: 'notice',
      notice: 'memberJoined',
      circleId: ids.circle,
      ts: NOW,
    };
    const unsigned = sealPush({ recipient: toBob, sender: null, body: notice });
    expect(oldApp(unsigned)).toEqual({ senderDeviceId: null, body: notice });
    const poke: PushBody = { kind: 'bump', circleId: ids.circle, ts: NOW };
    const fromAlice = sealPush({ recipient: toBob, sender: alice, body: poke });
    expect(oldApp(fromAlice)).toEqual({ senderDeviceId: alice.deviceId, body: poke });
  });
});

// Güvendeyim (docs/ADR/0029) adds a member's push of a kind that did not exist: `safe`. An app from
// before it has the push body schema of that time, today's without that kind (a strict union
// refuses what it does not list: that refusal is what is shown here). It must drop the box the way
// it drops any it cannot read, with its own error, which its caller (apps/mobile
// background-push.ts, which turns every openPush error into "refused") already catches.
describe('an app from before Güvendeyim', () => {
  const beforeSafe: BodySchema = {
    safeParse: (value) =>
      typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'safe'
        ? { success: false }
        : pushBodySchema.safeParse(value),
  };
  const safe: PushBody = {
    kind: 'safe',
    circleId: ids.circle,
    id: 'AAAAAAAAAAAAAAAAAAAAAA',
    bat: 45,
    ts: NOW,
  };
  const old = (sealed: string) =>
    openPushWith(beforeSafe, { recipient: bob, sealed, senderIdentityKey: known });

  it('drops a member’s safe push silently: its own "invalid push body" error', () => {
    const sealed = sealPush({ recipient: toBob, sender: alice, body: safe });
    let code = 'opened';
    try {
      old(sealed);
    } catch (error) {
      code = error instanceof BarguCryptoError ? error.code : 'UNEXPECTED';
    }
    expect(code).toBe('MALFORMED');
    // Today's code opens the very same box, and the signature is checked as for a poke.
    expect(openPush({ recipient: bob, sealed, senderIdentityKey: known })).toMatchObject({
      senderDeviceId: alice.deviceId,
      body: safe,
    });
  });

  it('keeps opening a poke, and still refuses a safe push from a device it does not know', () => {
    const poke: PushBody = { kind: 'bump', circleId: ids.circle, ts: NOW };
    expect(old(sealPush({ recipient: toBob, sender: alice, body: poke })).body).toEqual(poke);
    const stranger = testDevice(ids.carolDevice, 5);
    const forged = sealPush({ recipient: toBob, sender: stranger, body: safe });
    expect(() => old(forged)).toThrow(BarguCryptoError);
  });
});

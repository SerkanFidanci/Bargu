// Cross-implementation fixtures: deterministic outputs of this implementation that the Swift
// (CryptoKit) tests in packages/crypto/swift must open and verify byte-for-byte.
// Regenerate after an intentional protocol change: UPDATE_FIXTURES=1 pnpm --filter @bargu/crypto test
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PUSH_NOTICES, pushBodySchema } from '@bargu/schemas';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { LABELS, PROTOCOL_VERSION, SAFETY_NUMBER_ITERATIONS } from '../src/constants.js';
import { concatBytes, toBase64url, utf8Decode, utf8Encode } from '../src/encoding.js';
import { exportDeviceKeyBundle, verifyDeviceKeyBundle } from '../src/keys.js';
import { decryptMessage, encryptMessageWith } from '../src/message.js';
import { ReplayGuard } from '../src/replay.js';
import { openPush, sealPushWith } from '../src/push.js';
import { openSealed, sealForDeviceWith } from '../src/sealed.js';
import { safetyNumber } from '../src/safety-number.js';
import { createSenderKeyDistributionWith, openSenderKeyDistribution } from '../src/sender-key.js';
import {
  noticePublicKey,
  parseNoticeKeys,
  signServerNotice,
  verifyServerNotice,
} from '../src/server-notice.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

const fixturePath = fileURLToPath(new URL('../fixtures/protocol-v1.json', import.meta.url));

/** TEST-ONLY server notice key (docs/ADR/0016 Ek): fixed, so the vectors are reproducible. */
const noticeSigner = { secretKey: new Uint8Array(32).fill(0x0c), kid: 'test-n1' };
const NOTICE_TS = 1_791_880_000_000;

/**
 * Signed server notices (QA-28 B-1): a genuine one, one of every kind, and what a member can forge
 * from what they know (every member device's DH key, the notices sealed for their own device).
 */
function noticeFixtures(bob: ReturnType<typeof testDevice>, alice: ReturnType<typeof testDevice>) {
  const recipient = { deviceId: bob.deviceId, dhKey: bob.dh.publicKey };
  const body = {
    kind: 'notice',
    notice: 'circleInvite',
    circleId: ids.circle,
    ts: NOTICE_TS,
  } as const;
  const json = utf8Encode(JSON.stringify(body));
  const id = new Uint8Array(16).fill(0x0e);
  const signed = (signer: typeof noticeSigner, deviceId = bob.deviceId, bytes = json) =>
    signServerNotice({ signer, recipientDeviceId: deviceId, body: bytes, issuedAt: NOTICE_TS, id });
  const toBob = (inner: Uint8Array, fill: number) =>
    sealForDeviceWith(bob.dh.publicKey, inner, new Uint8Array(32).fill(fill));
  const genuine = signed(noticeSigner);
  const changed = utf8Encode(JSON.stringify({ ...body, notice: 'memberJoined' }));
  return {
    noticeKey: {
      kid: noticeSigner.kid,
      secretKey: bytesToHex(noticeSigner.secretKey),
      publicKey: noticePublicKey(noticeSigner.secretKey),
    },
    serverNotice: {
      recipient: 'bob',
      sealed: sealPushWith(
        { recipient, sender: null, body, signer: noticeSigner },
        new Uint8Array(32).fill(0x0d),
        id,
      ),
      body: JSON.stringify(body),
      kid: noticeSigner.kid,
      id: toBase64url(id),
      issuedAt: NOTICE_TS,
    },
    serverNotices: PUSH_NOTICES.map((notice, index) => ({
      notice,
      sealed: sealPushWith(
        { recipient, sender: null, body: { ...body, notice }, signer: noticeSigner },
        new Uint8Array(32).fill(0x20 + index),
        new Uint8Array(16).fill(0x40 + index),
      ),
    })),
    // Each sealed for Bob; none may be accepted as the server's.
    forgedNotices: {
      unsigned: toBob(concatBytes(Uint8Array.of(0), json), 0x10),
      wrongKey: toBob(signed({ ...noticeSigner, secretKey: new Uint8Array(32).fill(0x0f) }), 0x11),
      unknownKid: toBob(signed({ ...noticeSigner, kid: 'test-n2' }), 0x12),
      // A genuine notice Alice received, sealed again for Bob.
      otherRecipient: toBob(signed(noticeSigner, alice.deviceId), 0x13),
      bodyChanged: toBob(
        concatBytes(genuine.subarray(0, genuine.length - json.length), changed),
        0x14,
      ),
    },
  };
}

function buildFixtures() {
  const alice = testDevice(ids.aliceDevice, 1);
  const bob = testDevice(ids.bobDevice, 3);
  const senderKey = {
    circleId: ids.circle,
    epoch: 4,
    senderDeviceId: ids.aliceDevice,
    key: new Uint8Array(32).fill(0x42),
  };
  const distribution = createSenderKeyDistributionWith(
    { senderKey, sender: alice, recipient: publicKeysOf(bob) },
    new Uint8Array(32).fill(0x07),
  );
  const { envelope } = encryptMessageWith(
    { state: { senderKey, nextSeq: 5 }, sender: alice, payload: locationPayload },
    new Uint8Array(16).fill(0x11),
  );
  const pushPlaintext = JSON.stringify({ circleId: ids.circle, envelope });
  const sealed = sealForDeviceWith(
    bob.dh.publicKey,
    utf8Encode(pushPlaintext),
    new Uint8Array(32).fill(0x09),
  );
  // Notifications (docs/PROTOCOL.md §7): what the iOS extension opens.
  const recipient = { deviceId: bob.deviceId, dhKey: bob.dh.publicKey };
  const placeBody = {
    kind: 'place',
    circleId: ids.circle,
    placeId: ids.place,
    event: 'enter',
    name: 'Ev',
    emoji: '🏠',
    ts: 1_791_880_000_000,
  } as const;
  const noticeBody = {
    kind: 'notice',
    notice: 'circleInvite',
    circleId: ids.circle,
    ts: 1_791_880_000_000,
  } as const;
  // The notice id is only used by signed server notices.
  const signedPush = sealPushWith(
    { recipient, sender: alice, body: placeBody },
    new Uint8Array(32).fill(0x0a),
    new Uint8Array(16),
  );
  const noticePush = sealPushWith(
    { recipient, sender: null, body: noticeBody },
    new Uint8Array(32).fill(0x0b),
    new Uint8Array(16),
  );
  const number = safetyNumber(
    { userId: ids.aliceUser, identityKey: alice.identity.publicKey },
    { userId: ids.bobUser, identityKey: bob.identity.publicKey },
  );
  const device = (keys: typeof alice) => ({
    deviceId: keys.deviceId,
    identitySecretKey: bytesToHex(keys.identity.secretKey),
    dhSecretKey: bytesToHex(keys.dh.secretKey),
    bundle: exportDeviceKeyBundle(keys),
  });

  return {
    description:
      'TEST-ONLY deterministic vectors for the Bargu protocol v1 (docs/PROTOCOL.md). Secrets here are fixed test values.',
    protocolVersion: PROTOCOL_VERSION,
    labels: LABELS,
    safetyNumberIterations: SAFETY_NUMBER_ITERATIONS,
    devices: { alice: device(alice), bob: device(bob) },
    senderKeyDistribution: {
      sender: 'alice',
      recipient: 'bob',
      senderKey: bytesToHex(senderKey.key),
      distribution,
    },
    message: {
      sender: 'alice',
      senderKey: bytesToHex(senderKey.key),
      envelope,
      plaintext: JSON.stringify(locationPayload),
    },
    sealedPush: { recipient: 'bob', sealed, plaintext: pushPlaintext },
    signedPush: {
      recipient: 'bob',
      sender: 'alice',
      sealed: signedPush,
      body: JSON.stringify(placeBody),
    },
    noticePush: { recipient: 'bob', sealed: noticePush, body: JSON.stringify(noticeBody) },
    ...noticeFixtures(bob, alice),
    safetyNumber: {
      alice: { userId: ids.aliceUser, identityKey: bytesToHex(alice.identity.publicKey) },
      bob: { userId: ids.bobUser, identityKey: bytesToHex(bob.identity.publicKey) },
      digits: number.digits,
      qr: number.qr,
    },
  };
}

describe('cross-implementation fixtures', () => {
  const fixtures = buildFixtures();

  it('match the committed file (protocol unchanged)', () => {
    if (process.env.UPDATE_FIXTURES === '1') {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant path from import.meta.url, no user input
      writeFileSync(fixturePath, `${JSON.stringify(fixtures, null, 2)}\n`);
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant path from import.meta.url, no user input
    expect(JSON.parse(readFileSync(fixturePath, 'utf8'))).toEqual(fixtures);
  });

  it('open with the public API', () => {
    const alice = testDevice(ids.aliceDevice, 1);
    const bob = testDevice(ids.bobDevice, 3);
    expect(verifyDeviceKeyBundle(fixtures.devices.alice.bundle).identityKey).toEqual(
      alice.identity.publicKey,
    );
    const senderKey = openSenderKeyDistribution({
      distribution: fixtures.senderKeyDistribution.distribution,
      recipient: bob,
      sender: publicKeysOf(alice),
    });
    expect(bytesToHex(senderKey.key)).toBe(fixtures.senderKeyDistribution.senderKey);
    expect(
      decryptMessage({
        envelope: fixtures.message.envelope,
        senderKey,
        sender: publicKeysOf(alice),
        replay: new ReplayGuard(),
      }),
    ).toEqual(locationPayload);
    expect(utf8Decode(openSealed(bob, fixtures.sealedPush.sealed))).toBe(
      fixtures.sealedPush.plaintext,
    );
    const known = (deviceId: string) =>
      deviceId === alice.deviceId ? alice.identity.publicKey : null;
    expect(
      openPush({ recipient: bob, sealed: fixtures.signedPush.sealed, senderIdentityKey: known }),
    ).toEqual({
      senderDeviceId: alice.deviceId,
      body: pushBodySchema.parse(JSON.parse(fixtures.signedPush.body)),
      serverSignature: null,
    });
    expect(
      openPush({ recipient: bob, sealed: fixtures.noticePush.sealed, senderIdentityKey: known }),
    ).toEqual({
      senderDeviceId: null,
      body: pushBodySchema.parse(JSON.parse(fixtures.noticePush.body)),
      serverSignature: null,
    });
  });

  it('hold for signed server notices: the genuine ones verify, every forgery is dropped', () => {
    const bob = testDevice(ids.bobDevice, 3);
    const keys = parseNoticeKeys(`${fixtures.noticeKey.kid}:${fixtures.noticeKey.publicKey}`);
    const open = (sealed: string) =>
      openPush({ recipient: bob, sealed, senderIdentityKey: () => null });
    const check = (sealed: string) =>
      verifyServerNotice(open(sealed), { keys, now: NOTICE_TS, maxAgeMs: 60_000 });
    const genuine = open(fixtures.serverNotice.sealed);
    expect(genuine.body).toEqual(pushBodySchema.parse(JSON.parse(fixtures.serverNotice.body)));
    expect(check(fixtures.serverNotice.sealed)).toEqual({
      kid: fixtures.serverNotice.kid,
      id: fixtures.serverNotice.id,
      issuedAt: fixtures.serverNotice.issuedAt,
    });
    for (const { notice, sealed } of fixtures.serverNotices) {
      expect(open(sealed).body).toMatchObject({ kind: 'notice', notice });
      expect(check(sealed)).not.toBeNull();
    }
    for (const sealed of Object.values(fixtures.forgedNotices)) {
      expect(check(sealed)).toBeNull();
    }
  });
});

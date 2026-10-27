// Cross-implementation fixtures: deterministic outputs of this implementation that the Swift
// (CryptoKit) tests in packages/crypto/swift must open and verify byte-for-byte.
// Regenerate after an intentional protocol change: UPDATE_FIXTURES=1 pnpm --filter @bargu/crypto test
// Each fixture's randomness comes from its name (fixtureRandom), so adding an entry, such as a new
// notice kind, changes no existing one: a changed entry means the protocol changed.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PUSH_NOTICES, pushBodySchema } from '@bargu/schemas';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import {
  chatKeyOf,
  decryptChat,
  encryptChatWith,
  openChatPhoto,
  openDirect,
  openReportedItem,
  photoHashOf,
  revealChatItem,
  sealChatPhotoWith,
  sealDirectWith,
} from '../src/chat.js';
import { LABELS, PROTOCOL_VERSION, SAFETY_NUMBER_ITERATIONS } from '../src/constants.js';
import {
  concatBytes,
  fromBase64url,
  toBase64url,
  utf8Decode,
  utf8Encode,
} from '../src/encoding.js';
import { exportDeviceKeyBundle, verifyDeviceKeyBundle } from '../src/keys.js';
import { decryptMessage, encryptMessageWith } from '../src/message.js';
import { ReplayGuard } from '../src/replay.js';
import { hkdfSha256 } from '../src/primitives.js';
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

/** TEST-ONLY seed of the fixtures' randomness. */
const FIXTURE_SEED = utf8Encode('bargu/v1 cross-implementation fixtures, TEST ONLY');

/**
 * A fixture's randomness (ephemeral keys, salts, notice ids) from its name alone, never from its
 * place in a list: HKDF-SHA256 over a fixed seed with info "fixture/<kind>/<name>".
 */
function fixtureRandom(kind: string, name: string, length: number): Uint8Array {
  return hkdfSha256(FIXTURE_SEED, new Uint8Array(0), utf8Encode(`fixture/${kind}/${name}`), length);
}

/** TEST-ONLY server notice key (docs/ADR/0016 Ek): fixed, so the vectors are reproducible. */
const noticeSigner = { secretKey: new Uint8Array(32).fill(0x0c), kid: 'test-n1' };
const NOTICE_TS = 1_791_880_000_000;
const noticeBody = (notice: string) => ({
  kind: 'notice',
  notice,
  circleId: ids.circle,
  ts: NOTICE_TS,
});

/**
 * One signed notice of every kind given, sealed for Bob, each named by its kind. Sealed with the
 * same calls sealPush makes (signServerNotice, then the sealed box) so a kind the schema does not
 * know yet can be listed too.
 */
function serverNoticeEntries(bob: ReturnType<typeof testDevice>, kinds: readonly string[]) {
  return kinds.map((notice) => ({
    notice,
    sealed: sealForDeviceWith(
      bob.dh.publicKey,
      signServerNotice({
        signer: noticeSigner,
        recipientDeviceId: bob.deviceId,
        body: utf8Encode(JSON.stringify(noticeBody(notice))),
        issuedAt: NOTICE_TS,
        id: fixtureRandom('serverNotices', `${notice}/id`, 16),
      }),
      fixtureRandom('serverNotices', `${notice}/ephemeral`, 32),
    ),
  }));
}

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
  const id = fixtureRandom('serverNotice', 'id', 16);
  const signed = (signer: typeof noticeSigner, deviceId = bob.deviceId, bytes = json) =>
    signServerNotice({ signer, recipientDeviceId: deviceId, body: bytes, issuedAt: NOTICE_TS, id });
  const toBob = (inner: Uint8Array, name: string) =>
    sealForDeviceWith(bob.dh.publicKey, inner, fixtureRandom('forgedNotices', name, 32));
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
        fixtureRandom('serverNotice', 'ephemeral', 32),
        id,
      ),
      body: JSON.stringify(body),
      kid: noticeSigner.kid,
      id: toBase64url(id),
      issuedAt: NOTICE_TS,
    },
    serverNotices: serverNoticeEntries(bob, PUSH_NOTICES),
    // Each sealed for Bob; none may be accepted as the server's.
    forgedNotices: {
      unsigned: toBob(concatBytes(Uint8Array.of(0), json), 'unsigned'),
      wrongKey: toBob(
        signed({ ...noticeSigner, secretKey: new Uint8Array(32).fill(0x0f) }),
        'wrongKey',
      ),
      unknownKid: toBob(signed({ ...noticeSigner, kid: 'test-n2' }), 'unknownKid'),
      // A genuine notice Alice received, sealed again for Bob.
      otherRecipient: toBob(signed(noticeSigner, alice.deviceId), 'otherRecipient'),
      bodyChanged: toBob(
        concatBytes(genuine.subarray(0, genuine.length - json.length), changed),
        'bodyChanged',
      ),
    },
  };
}

/** Messages and moments (docs/ADR/0035): an item for a circle, one for a person, a photo file. */
const CHAT_TS = 1_791_880_000_000;
const chatIds = {
  text: '0190f7a4-3333-7333-8333-000000000001',
  photo: '0190f7a4-3333-7333-8333-000000000002',
  direct: '0190f7a4-3333-7333-8333-000000000003',
  blob: '0190f7a4-4444-7444-8444-000000000001',
};

function chatFixtures(
  alice: ReturnType<typeof testDevice>,
  bob: ReturnType<typeof testDevice>,
  senderKey: { circleId: string; epoch: number; senderDeviceId: string; key: Uint8Array },
) {
  const photoKey = fixtureRandom('chat', 'photo/key', 32);
  const image = utf8Encode('TEST ONLY: the bytes of a JPEG');
  const file = sealChatPhotoWith(
    photoKey,
    chatIds.blob,
    image,
    fixtureRandom('chat', 'photo/nonce', 12),
  );
  const text = { kind: 'text', id: chatIds.text, text: 'Merhaba 👋', ts: CHAT_TS } as const;
  const photo = {
    kind: 'photo',
    id: chatIds.photo,
    blobId: chatIds.blob,
    key: toBase64url(photoKey),
    size: file.length,
    hash: photoHashOf(file),
    w: 1200,
    h: 1600,
    story: true,
    ts: CHAT_TS,
  } as const;
  const direct = { kind: 'text', id: chatIds.direct, text: 'Yalnız sana', ts: CHAT_TS } as const;
  const circleItem = encryptChatWith(
    { senderKey, sender: alice, payload: text },
    fixtureRandom('chat', 'text/salt', 16),
  );
  return {
    chat: {
      sender: 'alice',
      senderKey: bytesToHex(senderKey.key),
      chatKey: bytesToHex(chatKeyOf(senderKey).key),
      now: CHAT_TS,
      text: { envelope: circleItem, plaintext: JSON.stringify(text) },
      photo: {
        envelope: encryptChatWith(
          { senderKey, sender: alice, payload: photo },
          fixtureRandom('chat', 'photo/salt', 16),
        ),
        plaintext: JSON.stringify(photo),
        file: toBase64url(file),
        image: toBase64url(image),
      },
      direct: {
        recipient: 'bob',
        envelope: sealDirectWith(
          { sender: alice, recipient: publicKeysOf(bob), payload: direct },
          fixtureRandom('chat', 'direct/ephemeral', 32),
        ),
        plaintext: JSON.stringify(direct),
      },
      report: revealChatItem({
        envelope: circleItem,
        chatKey: chatKeyOf(senderKey),
        sender: publicKeysOf(alice),
      }),
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
    fixtureRandom('senderKeyDistribution', 'ephemeral', 32),
  );
  const { envelope } = encryptMessageWith(
    { state: { senderKey, nextSeq: 5 }, sender: alice, payload: locationPayload },
    fixtureRandom('message', 'salt', 16),
  );
  const pushPlaintext = JSON.stringify({ circleId: ids.circle, envelope });
  const sealed = sealForDeviceWith(
    bob.dh.publicKey,
    utf8Encode(pushPlaintext),
    fixtureRandom('sealedPush', 'ephemeral', 32),
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
  const unsignedNotice = {
    kind: 'notice',
    notice: 'circleInvite',
    circleId: ids.circle,
    ts: 1_791_880_000_000,
  } as const;
  // The notice id is only used by signed server notices.
  const signedPush = sealPushWith(
    { recipient, sender: alice, body: placeBody },
    fixtureRandom('signedPush', 'ephemeral', 32),
    new Uint8Array(16),
  );
  const noticePush = sealPushWith(
    { recipient, sender: null, body: unsignedNotice },
    fixtureRandom('noticePush', 'ephemeral', 32),
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
    noticePush: { recipient: 'bob', sealed: noticePush, body: JSON.stringify(unsignedNotice) },
    ...noticeFixtures(bob, alice),
    ...chatFixtures(alice, bob, senderKey),
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

  it('open messages and moments with the public API (docs/ADR/0035)', () => {
    const alice = testDevice(ids.aliceDevice, 1);
    const bob = testDevice(ids.bobDevice, 3);
    const { chat } = fixtures;
    const chatKey = {
      circleId: ids.circle,
      epoch: 4,
      senderDeviceId: alice.deviceId,
      key: hexToBytes(chat.chatKey),
    };
    const open = (envelope: unknown) =>
      decryptChat({ envelope, chatKey, sender: publicKeysOf(alice), now: chat.now });
    expect(JSON.stringify(open(chat.text.envelope))).toBe(chat.text.plaintext);
    const photo = open(chat.photo.envelope);
    expect(JSON.stringify(photo)).toBe(chat.photo.plaintext);
    if (photo.kind !== 'photo') throw new Error('expected a photo');
    expect(
      openChatPhoto({
        key: fromBase64url(photo.key),
        blobId: photo.blobId,
        hash: photo.hash,
        sealed: fromBase64url(chat.photo.file),
      }),
    ).toEqual(fromBase64url(chat.photo.image));
    expect(
      JSON.stringify(
        openDirect({
          envelope: chat.direct.envelope,
          recipient: bob,
          sender: publicKeysOf(alice),
          now: chat.now,
        }),
      ),
    ).toBe(chat.direct.plaintext);
    expect(
      JSON.stringify(
        openReportedItem({
          envelope: chat.text.envelope,
          ...chat.report,
          senderIdentityKey: alice.identity.publicKey,
        }),
      ),
    ).toBe(chat.text.plaintext);
  });

  it('take their randomness from their names: a new notice kind changes no other entry', () => {
    const bob = testDevice(ids.bobDevice, 3);
    const kinds: readonly string[] = PUSH_NOTICES;
    // A kind inserted in the middle and one at the end, as a future slice would add them.
    const longer = [...kinds.slice(0, 3), 'aNewKind', ...kinds.slice(3), 'zLastKind'];
    const known = new Set(kinds);
    const again = serverNoticeEntries(bob, longer).filter((entry) => known.has(entry.notice));
    expect(again).toEqual(fixtures.serverNotices);
    expect(again.map((entry) => entry.notice)).toEqual(kinds);
    // Different names, different randomness; the same name, the same bytes.
    expect(fixtureRandom('serverNotices', 'watch/id', 16)).toEqual(
      fixtureRandom('serverNotices', 'watch/id', 16),
    );
    expect(fixtureRandom('serverNotices', 'watch/id', 16)).not.toEqual(
      fixtureRandom('serverNotices', 'memberJoined/id', 16),
    );
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

import {
  CHAT_LIFETIME_MS,
  CHAT_PHOTO_MAX_BYTES,
  CHAT_TEXT_MAX,
  codePointsOf,
  type ChatPayload,
} from '@bargu/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CHAT_MAX_FUTURE_MS,
  chatKeyOf,
  decryptChat,
  encryptChat,
  encryptChatPaddedWith,
  openChatPhoto,
  openDirect,
  openReportedItem,
  photoHashOf,
  revealChatItem,
  revealDirectItem,
  sealChatPhoto,
  sealChatPhotoWith,
  sealDirect,
  sealDirectPaddedWith,
  sealDirectWith,
  verifyChatEnvelope,
  verifyDirectEnvelope,
} from '../src/chat.js';
import { fromBase64url, toBase64url, utf8Encode } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import {
  createSenderState,
  decryptDocument,
  decryptHistory,
  decryptMessage,
  encryptMessage,
  historyKeyOf,
  verifyMessageEnvelope,
} from '../src/message.js';
import { pad } from '../src/padding.js';
import { randomBytes } from '../src/primitives.js';
import { generatePhotoKey } from '../src/profile.js';
import { ReplayGuard } from '../src/replay.js';
import { generateSenderKey } from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const carol = testDevice(ids.carolDevice, 5);
const senderKey = generateSenderKey({
  circleId: ids.circle,
  epoch: 7,
  senderDeviceId: alice.deviceId,
});
const chatKey = chatKeyOf(senderKey);
const NOW = 1_791_880_000_000;
const itemIds = {
  a: '0190f7a4-3333-7333-8333-000000000001',
  b: '0190f7a4-3333-7333-8333-000000000002',
  blob: '0190f7a4-4444-7444-8444-000000000001',
};

const text = (over: Partial<Extract<ChatPayload, { kind: 'text' }>> = {}): ChatPayload => ({
  kind: 'text',
  id: itemIds.a,
  text: 'Merhaba 👋',
  ts: NOW,
  ...over,
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const seal = (payload: ChatPayload = text()) => encryptChat({ senderKey, sender: alice, payload });
const open = (envelope: unknown, now = NOW, key = chatKey) =>
  decryptChat({ envelope, chatKey: key, sender: publicKeysOf(alice), now });

const sealFor = (payload: ChatPayload = text()) =>
  sealDirect({ sender: alice, recipient: publicKeysOf(bob), payload });
const openAsBob = (envelope: unknown, now = NOW) =>
  openDirect({ envelope, recipient: bob, sender: publicKeysOf(alice), now });

describe('an item for a circle (docs/ADR/0035 §2)', () => {
  it('opens with the chat key of the epoch, and every kind round-trips', () => {
    const payloads: ChatPayload[] = [
      text({ replyTo: itemIds.b }),
      {
        kind: 'photo',
        id: itemIds.a,
        blobId: itemIds.blob,
        key: toBase64url(new Uint8Array(32).fill(9)),
        size: 1234,
        hash: toBase64url(new Uint8Array(32).fill(8)),
        w: 1200,
        h: 1600,
        caption: 'Taksim',
        story: true,
        ts: NOW,
      },
      { kind: 'del', id: itemIds.a, target: itemIds.b, ts: NOW },
      { kind: 'shot', id: itemIds.a, target: itemIds.b, ts: NOW },
    ];
    for (const payload of payloads) expect(open(seal(payload))).toEqual(payload);
  });

  it('is never sealed with the sender key itself, and opens again and again', () => {
    const envelope = seal();
    expect(chatKey.key).not.toEqual(senderKey.key);
    expect(open(envelope)).toEqual(text());
    expect(open(envelope)).toEqual(text());
    expect(codeOf(() => open(envelope, NOW, senderKey))).toBe('DECRYPT_FAILED');
  });

  it('pads to 1024 or 8192 bytes: only "short or long" shows', () => {
    expect(fromBase64url(seal().ct)).toHaveLength(1024 + 16);
    const longest = text({ text: '\u0001'.repeat(CHAT_TEXT_MAX) });
    const envelope = seal(longest);
    expect(fromBase64url(envelope.ct)).toHaveLength(8192 + 16);
    expect(open(envelope)).toEqual(longest);
  });

  it('round-trips arbitrary texts (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: CHAT_TEXT_MAX, unit: 'grapheme' }),
        (words) => {
          const payload = text({ text: words });
          const valid = words.trim().length > 0 && codePointsOf(words) <= CHAT_TEXT_MAX;
          if (!valid) {
            expect(codeOf(() => seal(payload))).toBe('MALFORMED');
            return;
          }
          expect(open(seal(payload))).toEqual(payload);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('refuses invalid items before sealing, and another device’s sender key', () => {
    expect(codeOf(() => seal(text({ text: '   ' })))).toBe('MALFORMED');
    expect(codeOf(() => seal(text({ text: 'x'.repeat(CHAT_TEXT_MAX + 1) })))).toBe('MALFORMED');
    expect(codeOf(() => encryptChat({ senderKey, sender: bob, payload: text() }))).toBe(
      'KEY_MISMATCH',
    );
  });

  it('never reuses key material: the same item twice gives different ciphertexts', () => {
    const first = seal();
    const second = seal();
    expect(first.salt).not.toBe(second.salt);
    expect(first.commit).not.toBe(second.commit);
    expect(first.ct).not.toBe(second.ct);
  });

  it('keeps items for 24 hours and drops what is older or dated ahead', () => {
    const envelope = seal();
    expect(open(envelope, NOW + CHAT_LIFETIME_MS)).toEqual(text());
    expect(codeOf(() => open(envelope, NOW + CHAT_LIFETIME_MS + 1))).toBe('REPLAY');
    expect(open(envelope, NOW - CHAT_MAX_FUTURE_MS)).toEqual(text());
    expect(codeOf(() => open(envelope, NOW - CHAT_MAX_FUTURE_MS - 1))).toBe('REPLAY');
  });

  it('is opened only with the right sender, circle and epoch', () => {
    const envelope = seal();
    const otherSender = { ...chatKey, senderDeviceId: bob.deviceId };
    const otherCircle = { ...chatKey, circleId: ids.otherCircle };
    const otherEpoch = { ...chatKey, epoch: 8 };
    expect(codeOf(() => open(envelope, NOW, otherSender))).toBe('KEY_MISMATCH');
    expect(codeOf(() => open(envelope, NOW, otherCircle))).toBe('KEY_MISMATCH');
    expect(codeOf(() => open(envelope, NOW, otherEpoch))).toBe('KEY_MISMATCH');
    expect(
      codeOf(() => decryptChat({ envelope, chatKey, sender: publicKeysOf(bob), now: NOW })),
    ).toBe('KEY_MISMATCH');
    // Claimed by another sender of the same circle: their signature does not match.
    const asCarol = { ...envelope, senderDeviceId: carol.deviceId };
    expect(
      codeOf(() =>
        decryptChat({
          envelope: asCarol,
          chatKey: { ...chatKey, senderDeviceId: carol.deviceId },
          sender: publicKeysOf(carol),
          now: NOW,
        }),
      ),
    ).toBe('BAD_SIGNATURE');
  });

  it('rejects any single flipped bit in the header, commitment, ciphertext or signature (property)', () => {
    const envelope = seal();
    fc.assert(
      fc.property(
        fc.constantFrom('salt', 'commit', 'ct', 'sig'),
        fc.nat(),
        fc.integer({ min: 0, max: 7 }),
        (field, index, bit) => {
          const bytes = fromBase64url(envelope[field]);
          const position = index % bytes.length;
          bytes[position] = (bytes[position] ?? 0) ^ (1 << bit);
          const tampered = { ...envelope, [field]: toBase64url(bytes) };
          expect(codeOf(() => open(tampered))).toBe('BAD_SIGNATURE');
          expect(verifyChatEnvelope(tampered, alice.identity.publicKey)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
    const otherId = { ...envelope, id: itemIds.b };
    expect(codeOf(() => open(otherId))).toBe('BAD_SIGNATURE');
  });

  it('lets the server check the sender’s signature without any key', () => {
    const envelope = seal();
    expect(verifyChatEnvelope(envelope, alice.identity.publicKey)).toBe(true);
    expect(verifyChatEnvelope(envelope, bob.identity.publicKey)).toBe(false);
    expect(verifyChatEnvelope({ ...envelope, v: 2 }, alice.identity.publicKey)).toBe(false);
    expect(verifyChatEnvelope(null, alice.identity.publicKey)).toBe(false);
    expect(codeOf(() => open({ ...envelope, extra: 1 }))).toBe('MALFORMED');
  });

  it('cannot pass for a location, a document or history, nor they for it', () => {
    const envelope = seal();
    const replay = new ReplayGuard();
    const asMessage = {
      v: 1,
      circleId: envelope.circleId,
      epoch: envelope.epoch,
      senderDeviceId: envelope.senderDeviceId,
      seq: 0,
      salt: envelope.salt,
      ct: envelope.ct,
      sig: envelope.sig,
    };
    expect(
      codeOf(() =>
        decryptMessage({ envelope: asMessage, senderKey, sender: publicKeysOf(alice), replay }),
      ),
    ).toBe('MALFORMED');
    expect(verifyMessageEnvelope(asMessage, alice.identity.publicKey)).toBe(false);
    expect(
      codeOf(() =>
        decryptDocument({ envelope: asMessage, senderKey, sender: publicKeysOf(alice) }),
      ),
    ).toBe('BAD_SIGNATURE');
    // A long item has a size history allows: then its signature tells them apart.
    const long = seal(text({ text: 'ş'.repeat(CHAT_TEXT_MAX) }));
    expect(
      codeOf(() =>
        decryptHistory({
          envelope: { ...asMessage, salt: long.salt, ct: long.ct, sig: long.sig },
          historyKey: historyKeyOf(senderKey),
          sender: publicKeysOf(alice),
        }),
      ),
    ).toBe('BAD_SIGNATURE');
    const location = encryptMessage({
      state: createSenderState(senderKey),
      sender: alice,
      payload: locationPayload,
    }).envelope;
    expect(codeOf(() => open({ ...location, id: itemIds.a, commit: envelope.commit }))).toBe(
      'MALFORMED',
    );
  });
});

describe('a malicious sender of a circle item', () => {
  const sealPadded = (
    plaintext: Uint8Array,
    id = itemIds.a,
    commitOf?: Parameters<typeof encryptChatPaddedWith>[4],
  ) =>
    encryptChatPaddedWith({ senderKey, sender: alice }, plaintext, id, randomBytes(16), commitOf);
  const padded = (json: string) => pad(utf8Encode(json), 1024, 1024);

  it('cannot have an item shown under a false commitment: phones drop it, a report fails', () => {
    const plaintext = padded(JSON.stringify(text()));
    const envelope = sealPadded(plaintext, itemIds.a, () => new Uint8Array(32));
    expect(verifyChatEnvelope(envelope, alice.identity.publicKey)).toBe(true);
    expect(codeOf(() => open(envelope))).toBe('DECRYPT_FAILED');
    expect(codeOf(() => revealChatItem({ envelope, chatKey, sender: publicKeysOf(alice) }))).toBe(
      'DECRYPT_FAILED',
    );
  });

  it('is refused for bad padding, bad UTF-8, bad JSON, a bad item or another id', () => {
    expect(codeOf(() => open(sealPadded(new Uint8Array(1024))))).toBe('DECRYPT_FAILED');
    const notUtf8 = pad(Uint8Array.of(0xff, 0xfe), 1024, 1024);
    expect(codeOf(() => open(sealPadded(notUtf8)))).toBe('MALFORMED');
    expect(codeOf(() => open(sealPadded(padded('{not json'))))).toBe('MALFORMED');
    expect(codeOf(() => open(sealPadded(padded('{"kind":"loc"}'))))).toBe('MALFORMED');
    expect(codeOf(() => open(sealPadded(padded(JSON.stringify(text())), itemIds.b)))).toBe(
      'MALFORMED',
    );
  });

  it('cannot seal with another device’s sender key', () => {
    expect(
      codeOf(() =>
        encryptChatPaddedWith(
          { senderKey, sender: bob },
          new Uint8Array(1024),
          itemIds.a,
          randomBytes(16),
        ),
      ),
    ).toBe('KEY_MISMATCH');
  });
});

describe('an item for one person (docs/ADR/0035 §3)', () => {
  it('opens only on the device it was sealed to', () => {
    const envelope = sealFor();
    expect(openAsBob(envelope)).toEqual(text());
    expect(
      codeOf(() =>
        openDirect({ envelope, recipient: carol, sender: publicKeysOf(alice), now: NOW }),
      ),
    ).toBe('WRONG_RECIPIENT');
    expect(
      codeOf(() => openDirect({ envelope, recipient: bob, sender: publicKeysOf(carol), now: NOW })),
    ).toBe('KEY_MISMATCH');
  });

  it('uses a fresh key per item and keeps the 24-hour clock', () => {
    const first = sealFor();
    expect(sealFor().ephemeralKey).not.toBe(first.ephemeralKey);
    expect(codeOf(() => openAsBob(first, NOW + CHAT_LIFETIME_MS + 1))).toBe('REPLAY');
    expect(codeOf(() => openAsBob(first, NOW - CHAT_MAX_FUTURE_MS - 1))).toBe('REPLAY');
  });

  it('rejects any single flipped bit (property), and the server checks the signature', () => {
    const envelope = sealFor();
    fc.assert(
      fc.property(
        fc.constantFrom('ephemeralKey', 'commit', 'ct', 'sig'),
        fc.nat(),
        fc.integer({ min: 0, max: 7 }),
        (field, index, bit) => {
          const bytes = fromBase64url(envelope[field]);
          const position = index % bytes.length;
          bytes[position] = (bytes[position] ?? 0) ^ (1 << bit);
          const tampered = { ...envelope, [field]: toBase64url(bytes) };
          expect(codeOf(() => openAsBob(tampered))).toBe('BAD_SIGNATURE');
          expect(verifyDirectEnvelope(tampered, alice.identity.publicKey)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
    expect(verifyDirectEnvelope(envelope, alice.identity.publicKey)).toBe(true);
    expect(verifyDirectEnvelope(envelope, bob.identity.publicKey)).toBe(false);
    expect(verifyDirectEnvelope({}, alice.identity.publicKey)).toBe(false);
  });

  it('is told apart from a circle item, both ways', () => {
    const direct = sealFor();
    const circle = seal();
    expect(codeOf(() => open(direct))).toBe('MALFORMED');
    expect(codeOf(() => openAsBob(circle))).toBe('MALFORMED');
    expect(verifyChatEnvelope(direct, alice.identity.publicKey)).toBe(false);
    expect(verifyDirectEnvelope(circle, alice.identity.publicKey)).toBe(false);
  });

  it('is refused under a false commitment, a low-order key or a bad plaintext', () => {
    const json = pad(utf8Encode(JSON.stringify(text())), 1024, 1024);
    const ephemeral = new Uint8Array(32).fill(0x42);
    const recipient = { sender: alice, recipient: publicKeysOf(bob) };
    const lying = sealDirectPaddedWith(
      recipient,
      json,
      itemIds.a,
      ephemeral,
      () => new Uint8Array(32),
    );
    expect(codeOf(() => openAsBob(lying))).toBe('DECRYPT_FAILED');
    expect(
      codeOf(() =>
        revealDirectItem({ envelope: lying, recipient: bob, sender: publicKeysOf(alice) }),
      ),
    ).toBe('DECRYPT_FAILED');
    const otherId = sealDirectPaddedWith(recipient, json, itemIds.b, ephemeral);
    expect(codeOf(() => openAsBob(otherId))).toBe('MALFORMED');
    // Another ephemeral key changes the signed header.
    const genuine = sealDirectWith({ ...recipient, payload: text() }, ephemeral);
    const lowOrder = { ...genuine, ephemeralKey: toBase64url(new Uint8Array(32)) };
    expect(verifyDirectEnvelope(lowOrder, alice.identity.publicKey)).toBe(false);
  });
});

describe('reports (docs/ADR/0035 §9)', () => {
  it('give the server one item’s key, with which it checks and reads only that item', () => {
    const envelope = seal(text({ text: 'tehdit' }));
    const key = revealChatItem({ envelope, chatKey, sender: publicKeysOf(alice) });
    expect(fromBase64url(key.key)).toHaveLength(32);
    expect(fromBase64url(key.nonce)).toHaveLength(12);
    expect(
      openReportedItem({ envelope, ...key, senderIdentityKey: alice.identity.publicKey }),
    ).toEqual(text({ text: 'tehdit' }));
    // The key opens nothing else the sender sent.
    const other = seal(text({ id: itemIds.b }));
    expect(
      codeOf(() =>
        openReportedItem({ envelope: other, ...key, senderIdentityKey: alice.identity.publicKey }),
      ),
    ).toBe('DECRYPT_FAILED');
  });

  it('work for an item sent to one person', () => {
    const envelope = sealFor(text({ text: 'rahatsız' }));
    const key = revealDirectItem({ envelope, recipient: bob, sender: publicKeysOf(alice) });
    expect(
      openReportedItem({ envelope, ...key, senderIdentityKey: alice.identity.publicKey }),
    ).toEqual(text({ text: 'rahatsız' }));
  });

  it('cannot frame anyone: a made-up key, someone else’s signature or a changed item fails', () => {
    const envelope = seal();
    const key = revealChatItem({ envelope, chatKey, sender: publicKeysOf(alice) });
    const forged = { key: toBase64url(randomBytes(32)), nonce: key.nonce };
    const report = (over: object) =>
      codeOf(() =>
        openReportedItem({
          envelope,
          ...key,
          senderIdentityKey: alice.identity.publicKey,
          ...over,
        }),
      );
    expect(report(forged)).toBe('DECRYPT_FAILED');
    expect(report({ nonce: toBase64url(randomBytes(12)) })).toBe('DECRYPT_FAILED');
    expect(report({ senderIdentityKey: bob.identity.publicKey })).toBe('BAD_SIGNATURE');
    expect(report({ envelope: { ...envelope, v: 3 } })).toBe('MALFORMED');
    expect(report({ key: 'short' })).toBe('MALFORMED');
  });
});

describe('photo files (docs/ADR/0035 §4)', () => {
  const image = utf8Encode('JPEG bytes, here only a stand-in');
  const key = generatePhotoKey();

  it('open with their key, the item’s hash and their id', () => {
    const sealed = sealChatPhoto(key, itemIds.blob, image);
    const hash = photoHashOf(sealed);
    expect(openChatPhoto({ key, blobId: itemIds.blob, hash, sealed })).toEqual(image);
    expect(sealChatPhoto(key, itemIds.blob, image)).not.toEqual(sealed);
  });

  it('refuse another file, another key, another id or a changed byte', () => {
    const sealed = sealChatPhoto(key, itemIds.blob, image);
    const hash = photoHashOf(sealed);
    const openWith = (over: object) =>
      codeOf(() => openChatPhoto({ key, blobId: itemIds.blob, hash, sealed, ...over }));
    expect(openWith({ hash: photoHashOf(sealChatPhoto(key, itemIds.blob, image)) })).toBe(
      'DECRYPT_FAILED',
    );
    expect(openWith({ key: generatePhotoKey() })).toBe('DECRYPT_FAILED');
    expect(openWith({ blobId: itemIds.a })).toBe('DECRYPT_FAILED');
    const changed = sealed.slice();
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    expect(openWith({ sealed: changed, hash: photoHashOf(changed) })).toBe('DECRYPT_FAILED');
  });

  it('commit to their key: a file sealed with a false commitment does not open', () => {
    const nonce = randomBytes(12);
    const sealed = sealChatPhotoWith(key, itemIds.blob, image, nonce);
    const lying = sealed.slice();
    lying.set(new Uint8Array(32), 13);
    expect(
      codeOf(() =>
        openChatPhoto({ key, blobId: itemIds.blob, hash: photoHashOf(lying), sealed: lying }),
      ),
    ).toBe('DECRYPT_FAILED');
  });

  it('refuse bad keys, sizes and versions', () => {
    const sealed = sealChatPhoto(key, itemIds.blob, image);
    const hash = photoHashOf(sealed);
    expect(codeOf(() => sealChatPhoto(new Uint8Array(16), itemIds.blob, image))).toBe(
      'INVALID_KEY',
    );
    expect(codeOf(() => sealChatPhoto(key, itemIds.blob, new Uint8Array(0)))).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    expect(
      codeOf(() => sealChatPhoto(key, itemIds.blob, new Uint8Array(CHAT_PHOTO_MAX_BYTES))),
    ).toBe('PAYLOAD_TOO_LARGE');
    const fits = new Uint8Array(CHAT_PHOTO_MAX_BYTES - 45 - 16);
    expect(sealChatPhoto(key, itemIds.blob, fits)).toHaveLength(CHAT_PHOTO_MAX_BYTES);
    const openSealed = (bytes: Uint8Array, k = key) =>
      codeOf(() => openChatPhoto({ key: k, blobId: itemIds.blob, hash, sealed: bytes }));
    expect(openSealed(sealed, new Uint8Array(31))).toBe('INVALID_KEY');
    expect(openSealed(sealed.subarray(0, 60))).toBe('MALFORMED');
    expect(openSealed(new Uint8Array(CHAT_PHOTO_MAX_BYTES + 1).fill(1))).toBe('MALFORMED');
    const version = sealed.slice();
    version[0] = 2;
    expect(openSealed(version)).toBe('MALFORMED');
  });
});

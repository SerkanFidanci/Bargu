import { MAX_SEALED_PUSH_CHARS, type PushBody } from '@bargu/schemas';
import { describe, expect, it } from 'vitest';

import { LABELS, MAX_PUSH_PADDED_BYTES, PUSH_PADDING_BLOCK_BYTES } from '../src/constants.js';
import {
  bytesToUuid,
  concatBytes,
  fromBase64url,
  utf8Encode,
  uuidToBytes,
} from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import { signWithLabel } from '../src/primitives.js';
import { openPush, sealPush } from '../src/push.js';
import { openSealed, sealForDevice } from '../src/sealed.js';
import { ids, testDevice } from './helpers.js';

const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const carol = testDevice(ids.carolDevice, 5);

const arrived: PushBody = {
  kind: 'place',
  circleId: ids.circle,
  placeId: ids.place,
  event: 'enter',
  name: 'Ev',
  emoji: '🏠',
  ts: 1_791_880_000_000,
};
const notice: PushBody = { kind: 'notice', notice: 'memberJoined', circleId: ids.circle, ts: 1 };

const toBob = { deviceId: bob.deviceId, dhKey: bob.dh.publicKey };
const known = (deviceId: string) => (deviceId === alice.deviceId ? alice.identity.publicKey : null);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

/** A box with an arbitrary inner plaintext, as a malicious server could make one. */
const raw = (inner: Uint8Array, to = bob) => sealForDevice(to.dh.publicKey, inner);

describe('sealed, signed pushes', () => {
  it("round-trips a member's push and a server notice", () => {
    const sealed = sealPush({ recipient: toBob, sender: alice, body: arrived });
    expect(openPush({ recipient: bob, sealed, senderIdentityKey: known })).toEqual({
      senderDeviceId: alice.deviceId,
      body: arrived,
      serverSignature: null,
    });
    // A server without a notice key seals its notices unsigned (signed ones: server-notice.spec).
    const fromServer = sealPush({ recipient: toBob, sender: null, body: notice });
    expect(openPush({ recipient: bob, sealed: fromServer, senderIdentityKey: known })).toEqual({
      senderDeviceId: null,
      body: notice,
      serverSignature: null,
    });
  });

  it('opens only on the device it was sealed for', () => {
    const sealed = sealPush({ recipient: toBob, sender: alice, body: arrived });
    expect(codeOf(() => openPush({ recipient: carol, sealed, senderIdentityKey: known }))).toBe(
      'DECRYPT_FAILED',
    );
  });

  it('cannot be re-addressed to another member (the recipient is signed)', () => {
    const sealed = sealPush({ recipient: toBob, sender: alice, body: arrived });
    const resealed = raw(openSealed(bob, sealed), carol);
    expect(
      codeOf(() => openPush({ recipient: carol, sealed: resealed, senderIdentityKey: known })),
    ).toBe('BAD_SIGNATURE');
  });

  it('refuses unknown senders and signatures by another key', () => {
    const sealed = sealPush({ recipient: toBob, sender: alice, body: arrived });
    expect(codeOf(() => openPush({ recipient: bob, sealed, senderIdentityKey: () => null }))).toBe(
      'KEY_MISMATCH',
    );
    expect(
      codeOf(() =>
        openPush({ recipient: bob, sealed, senderIdentityKey: () => carol.identity.publicKey }),
      ),
    ).toBe('BAD_SIGNATURE');
  });

  it('keeps the server to notices and members away from them', () => {
    // The server cannot make an unsigned "Ali arrived home".
    const forged = raw(concatBytes(Uint8Array.of(0), utf8Encode(JSON.stringify(arrived))));
    expect(
      codeOf(() => openPush({ recipient: bob, sealed: forged, senderIdentityKey: known })),
    ).toBe('MALFORMED');
    // A member cannot dress up as the server.
    const json = utf8Encode(JSON.stringify(notice));
    const signature = signWithLabel(
      LABELS.pushSignature,
      concatBytes(uuidToBytes(bob.deviceId), uuidToBytes(alice.deviceId), json),
      alice.identity.secretKey,
    );
    const signedNotice = raw(
      concatBytes(Uint8Array.of(1), uuidToBytes(alice.deviceId), signature, json),
    );
    expect(
      codeOf(() => openPush({ recipient: bob, sealed: signedNotice, senderIdentityKey: known })),
    ).toBe('MALFORMED');
    expect(codeOf(() => sealPush({ recipient: toBob, sender: alice, body: notice }))).toBe(
      'MALFORMED',
    );
    expect(codeOf(() => sealPush({ recipient: toBob, sender: null, body: arrived }))).toBe(
      'MALFORMED',
    );
  });

  it('refuses malformed inner plaintexts and bodies', () => {
    const open = (inner: Uint8Array) => () =>
      openPush({ recipient: bob, sealed: raw(inner), senderIdentityKey: known });
    expect(codeOf(open(Uint8Array.of(2, 0x7b, 0x7d)))).toBe('MALFORMED');
    expect(codeOf(open(new Uint8Array(81).fill(1)))).toBe('MALFORMED');
    expect(codeOf(open(Uint8Array.of(0, 0x7b)))).toBe('MALFORMED');
    expect(codeOf(open(Uint8Array.of(0, 0xff, 0xfe)))).toBe('MALFORMED');
    expect(codeOf(open(concatBytes(Uint8Array.of(0), utf8Encode('{"kind":"notice"}'))))).toBe(
      'MALFORMED',
    );
    expect(
      codeOf(() => sealPush({ recipient: toBob, sender: alice, body: { ...arrived, name: '' } })),
    ).toBe('MALFORMED');
  });

  it('stays well under what a push service carries', () => {
    // 40 two-byte letters and a family emoji (several code points): the longest a phone sends.
    const longest: PushBody = {
      ...arrived,
      name: String.fromCodePoint(0x11f).repeat(40),
      emoji: String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
    };
    expect(sealPush({ recipient: toBob, sender: alice, body: longest }).length).toBeLessThan(1_100);
  });

  describe('"Güvendeyim" with its place (docs/ADR/0029 §5, PROTOCOL §9)', () => {
    // The widest numbers JSON can spell (2^-1022: 17 digits and an exponent), the biggest battery
    // and time: the longest a phone seals.
    const widest = 2.2250738585072014e-308;
    const safe = (overrides: Partial<Extract<PushBody, { kind: 'safe' }>> = {}): PushBody => ({
      kind: 'safe',
      circleId: ids.circle,
      id: 'z'.repeat(21) + 'A',
      bat: 100,
      lat: -widest,
      lng: -widest,
      acc: widest,
      ts: Number.MAX_SAFE_INTEGER,
      ...overrides,
    });
    /** The padded plaintext of a box: its bytes less the version, the ephemeral key and the tag. */
    const paddedOf = (sealed: string) => fromBase64url(sealed).length - (1 + 32 + 16);

    it('fits at its largest in the block sizes pushes already use, under the request cap', () => {
      const sealed = sealPush({ recipient: toBob, sender: alice, body: safe() });
      // Under what one box may be in a request (MAX_SEALED_PUSH_CHARS) and what a push carries.
      expect(sealed.length).toBeLessThanOrEqual(MAX_SEALED_PUSH_CHARS);
      expect(paddedOf(sealed)).toBeLessThanOrEqual(MAX_PUSH_PADDED_BYTES);
      // A multiple of the 128-byte block, like every push; 384 here, the size of an arrival at
      // a place with a short name, below an arrival with a long one.
      expect(paddedOf(sealed) % PUSH_PADDING_BLOCK_BYTES).toBe(0);
      expect(paddedOf(sealed)).toBe(384);
      const longestPlace: PushBody = {
        ...arrived,
        name: 'ࠀ'.repeat(40),
        emoji: '❤'.repeat(16),
      };
      const arrival = sealPush({ recipient: toBob, sender: alice, body: longestPlace });
      expect(sealed.length).toBeLessThan(arrival.length);
      // The usual place (13 to 17 digits a number) is the same size: the digits tell nothing.
      const usual = sealPush({
        recipient: toBob,
        sender: alice,
        body: safe({ lat: 41.02561234567891, lng: 28.97421234567891, acc: 8.123456789, bat: 45 }),
      });
      expect(paddedOf(usual)).toBe(384);
    });

    it('restores the place when opened, to the digit, and refuses a place in parts', () => {
      const body = safe({ lat: 41.02561234567891, lng: 28.97421234567891, acc: 708 });
      const sealed = sealPush({ recipient: toBob, sender: alice, body });
      const opened = openPush({ recipient: bob, sealed, senderIdentityKey: known });
      expect(opened.senderDeviceId).toBe(alice.deviceId);
      expect(opened.body).toEqual(body);
      // Only a place whole goes in a box.
      const withoutAccuracy = JSON.parse(JSON.stringify({ ...body, acc: undefined })) as PushBody;
      expect(
        codeOf(() => sealPush({ recipient: toBob, sender: alice, body: withoutAccuracy })),
      ).toBe('MALFORMED');
      // The box says nothing in the clear about it: Google and Apple see ciphertext.
      expect(sealed).not.toContain('41.0256');
    });
  });
});

describe('uuid bytes', () => {
  it('round-trip and refuse other lengths', () => {
    expect(bytesToUuid(uuidToBytes(ids.place))).toBe(ids.place);
    expect(codeOf(() => bytesToUuid(new Uint8Array(15)))).toBe('MALFORMED');
  });
});

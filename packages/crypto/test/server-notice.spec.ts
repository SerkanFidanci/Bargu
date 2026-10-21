import { PUSH_NOTICES, type PushBody, type PushNotice } from '@bargu/schemas';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { LABELS } from '../src/constants.js';
import { concatBytes, readU64be, u64be, utf8Encode, uuidToBytes } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import { randomBytes, signWithLabel } from '../src/primitives.js';
import { type OpenedPush, openPush, sealPush, sealPushWith } from '../src/push.js';
import { openSealed, sealForDevice } from '../src/sealed.js';
import {
  NOTICE_MAX_FUTURE_MS,
  noticePublicKey,
  parseNoticeKeys,
  signServerNotice,
  verifyServerNotice,
} from '../src/server-notice.js';
import { ids, testDevice } from './helpers.js';

// QA-28 B-1: Alice is a member of Bob's circle, so she knows his device's DH key and can seal
// anything for him. Only the server's notice key can make a box Bob takes for the server's news.
const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const carol = testDevice(ids.carolDevice, 5);

const serverKey = randomBytes(32);
const signer = { secretKey: serverKey, kid: 'stg-n1' };
const keys = parseNoticeKeys(`stg-n1:${noticePublicKey(serverKey)}`);

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const notice = (kind: PushNotice, ts = NOW): PushBody => ({
  kind: 'notice',
  notice: kind,
  circleId: ids.circle,
  ts,
});
const recipientOf = (device: typeof bob) => ({
  deviceId: device.deviceId,
  dhKey: device.dh.publicKey,
});
const open = (sealed: string, recipient = bob) =>
  openPush({ recipient, sealed, senderIdentityKey: () => null });
const check = (opened: OpenedPush, seen: readonly string[] = [], now = NOW + MINUTE) =>
  verifyServerNotice(opened, { keys, now, maxAgeMs: HOUR, seen: (id) => seen.includes(id) });
/** What the server sends Bob when it has its notice key. */
const genuine = (kind: PushNotice, ts = NOW) =>
  sealPush({ recipient: recipientOf(bob), sender: null, body: notice(kind, ts), signer });

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

/** The inner plaintext with another body in place of the signed one (the body comes last). */
function withBody(inner: Uint8Array, before: PushBody, after: unknown): Uint8Array {
  const length = utf8Encode(JSON.stringify(before)).length;
  return concatBytes(inner.subarray(0, inner.length - length), utf8Encode(JSON.stringify(after)));
}

describe('signed server notices (QA-28 B-1, docs/ADR/0016 Ek)', () => {
  it.each(PUSH_NOTICES)('accepts a genuine %s, for the device it was signed for', (kind) => {
    const opened = open(genuine(kind));
    expect(opened.senderDeviceId).toBeNull();
    expect(opened.body).toEqual(notice(kind));
    const stamp = check(opened);
    expect(stamp).toEqual({ kid: 'stg-n1', id: opened.serverSignature?.id, issuedAt: NOW });
    // 16 random bytes: a fresh id for every notice.
    expect(stamp?.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(check(open(genuine(kind)))?.id).not.toBe(stamp?.id);
  });

  it.each(PUSH_NOTICES)('drops every %s a member can forge or replay', (kind) => {
    const body = notice(kind);
    const forge = (input: { signer?: typeof signer | null }) =>
      check(open(sealPush({ recipient: recipientOf(bob), sender: null, body, ...input })));

    // Unsigned: what every member could seal before (the QA reproduction).
    const unsigned = open(sealPush({ recipient: recipientOf(bob), sender: null, body }));
    expect(unsigned.body).toEqual(body);
    expect(unsigned.serverSignature).toBeNull();
    expect(check(unsigned)).toBeNull();
    // Signed with another key under the trusted kid, or with the right key under an unknown kid.
    expect(forge({ signer: { ...signer, secretKey: randomBytes(32) } })).toBeNull();
    expect(forge({ signer: { ...signer, kid: 'stg-n2' } })).toBeNull();

    // A genuine notice Alice received, sealed again for Bob: signed for Alice's device.
    const forAlice = sealPush({ recipient: recipientOf(alice), sender: null, body, signer });
    expect(check(open(forAlice, alice))).not.toBeNull();
    const resealed = sealForDevice(bob.dh.publicKey, openSealed(alice, forAlice));
    expect(open(resealed).body).toEqual(body);
    expect(check(open(resealed))).toBeNull();

    // Genuine for Bob, but stale, or seen before (the same box, or its content sealed anew).
    const sealed = genuine(kind);
    const opened = open(sealed);
    expect(check(opened, [], NOW + HOUR + 1)).toBeNull();
    const id = check(opened)?.id ?? '';
    expect(check(opened, [id])).toBeNull();
    expect(check(open(sealForDevice(bob.dh.publicKey, openSealed(bob, sealed))), [id])).toBeNull();

    // Genuine for Bob, with the body changed: another circle, another kind.
    const inner = openSealed(bob, sealed);
    for (const changed of [
      { ...body, circleId: ids.otherCircle },
      { ...body, notice: kind === 'watch' ? 'circleInvite' : 'watch' },
    ]) {
      const tampered = open(sealForDevice(bob.dh.publicKey, withBody(inner, body, changed)));
      expect(tampered.body).toEqual(changed);
      expect(check(tampered)).toBeNull();
    }
  });

  it.each(['watch', 'circleInvite'] as const)(
    'takes a %s dated up to 5 minutes ahead of the phone, not further',
    (kind) => {
      expect(NOTICE_MAX_FUTURE_MS).toBe(5 * MINUTE);
      // The phone's clock is behind: the notice looks dated in the future.
      const maxAgeMs = kind === 'watch' ? 2 * MINUTE : HOUR;
      const at = (ahead: number) =>
        verifyServerNotice(open(genuine(kind, NOW + ahead)), { keys, now: NOW, maxAgeMs });
      expect(at(4 * MINUTE)).not.toBeNull();
      expect(at(NOTICE_MAX_FUTURE_MS)).not.toBeNull();
      expect(at(NOTICE_MAX_FUTURE_MS + 1)).toBeNull();
      expect(at(HOUR)).toBeNull();
      // And on the other side, its age limit.
      expect(at(-maxAgeMs)).not.toBeNull();
      expect(at(-maxAgeMs - 1)).toBeNull();
    },
  );

  it.each(['watch', 'circleInvite'] as const)(
    'ages a %s dated ahead from its own date, not from when it arrived (QA-30 L-1)',
    (kind) => {
      const window = kind === 'watch' ? 2 * MINUTE : HOUR;
      const check = (issuedAt: number, now: number) =>
        verifyServerNotice(open(genuine(kind, issuedAt)), { keys, now, maxAgeMs: window });
      // 4 minutes ahead: taken now, and until its own date plus its window, never after.
      const issuedAt = NOW + 4 * MINUTE;
      expect(check(issuedAt, NOW)).not.toBeNull();
      expect(check(issuedAt, issuedAt + window)).not.toBeNull();
      expect(check(issuedAt, issuedAt + window + 1)).toBeNull();
      expect(check(issuedAt, NOW + 365 * 24 * HOUR)).toBeNull();
      // 6 minutes ahead: not taken at all.
      expect(check(NOW + 6 * MINUTE, NOW)).toBeNull();
    },
  );

  it('opens a box only for its device: Carol cannot even read a notice sealed for Bob', () => {
    expect(codeOf(() => open(genuine('watch'), carol))).toBe('DECRYPT_FAILED');
  });

  it('signs fixed bytes: version, kid, recipient device, time, id and the body', () => {
    const id = new Uint8Array(16).fill(0x0e);
    const body = notice('circleInvite');
    const sealed = sealPushWith(
      { recipient: recipientOf(bob), sender: null, body, signer },
      new Uint8Array(32).fill(0x0d),
      id,
    );
    const json = utf8Encode(JSON.stringify(body));
    const signed = concatBytes(
      Uint8Array.of(1, 6),
      utf8Encode('stg-n1'),
      uuidToBytes(bob.deviceId),
      u64be(NOW),
      id,
      json,
    );
    const opened = open(sealed);
    expect(bytesToHex(opened.serverSignature?.signed ?? new Uint8Array(0))).toBe(
      bytesToHex(signed),
    );
    // In the box: 0x02 ‖ len(kid) ‖ kid ‖ issuedAt ‖ id ‖ signature ‖ body.
    const signature = signWithLabel(LABELS.serverNotice, signed, serverKey);
    expect(bytesToHex(openSealed(bob, sealed))).toBe(
      bytesToHex(
        concatBytes(Uint8Array.of(2, 6), utf8Encode('stg-n1'), u64be(NOW), id, signature, json),
      ),
    );
    expect(LABELS.serverNotice).toBe('bargu/v1/server-notice');
  });

  it('refuses a malformed signed notice when opening it', () => {
    const seal = (inner: Uint8Array) => sealForDevice(bob.dh.publicKey, inner);
    const body = notice('memberJoined');
    const json = utf8Encode(JSON.stringify(body));
    const signedFor = (input: { issuedAt?: number; body?: Uint8Array; kid?: string }) =>
      signServerNotice({
        signer: { ...signer, kid: input.kid ?? signer.kid },
        recipientDeviceId: bob.deviceId,
        body: input.body ?? json,
        issuedAt: input.issuedAt ?? NOW,
        id: randomBytes(16),
      });
    const header = (kid: Uint8Array, issuedAt: Uint8Array) =>
      concatBytes(Uint8Array.of(2, kid.length), kid, issuedAt, new Uint8Array(16 + 64), json);
    for (const inner of [
      // Nothing after the first byte; no kid; a kid that is not one; a time beyond 2^53.
      Uint8Array.of(2),
      header(new Uint8Array(0), u64be(NOW)),
      header(utf8Encode('STG N1'), u64be(NOW)),
      header(utf8Encode('stg-n1'), new Uint8Array(8).fill(0xff)),
      // A header with no body after it.
      concatBytes(Uint8Array.of(2, 1), utf8Encode('k'), new Uint8Array(8 + 16 + 64)),
      // Signed, but its time is not the notice's own, or it is not a notice at all, or no JSON.
      signedFor({ issuedAt: NOW + 1 }),
      signedFor({
        body: utf8Encode(JSON.stringify({ kind: 'bump', circleId: ids.circle, ts: NOW })),
      }),
      signedFor({ body: utf8Encode('{"kind":') }),
    ]) {
      expect(codeOf(() => open(seal(inner)))).toBe('MALFORMED');
    }
    expect(codeOf(() => readU64be(new Uint8Array(8).fill(0xff)))).toBe('MALFORMED');
  });

  it('is signed by the server only, with a 32-byte key, a valid kid and a 16-byte id', () => {
    // A member's push is never signed by the server key, nor a notice by a member.
    const bump: PushBody = { kind: 'bump', circleId: ids.circle, ts: NOW };
    expect(
      codeOf(() => sealPush({ recipient: recipientOf(bob), sender: alice, body: bump, signer })),
    ).toBe('MALFORMED');
    const sign = (input: { secretKey?: Uint8Array; kid?: string; id?: Uint8Array }) => () =>
      signServerNotice({
        signer: { secretKey: input.secretKey ?? serverKey, kid: input.kid ?? 'stg-n1' },
        recipientDeviceId: bob.deviceId,
        body: utf8Encode('{}'),
        issuedAt: NOW,
        id: input.id ?? randomBytes(16),
      });
    expect(codeOf(sign({ secretKey: randomBytes(16) }))).toBe('INVALID_KEY');
    expect(codeOf(sign({ kid: 'Not A Kid' }))).toBe('MALFORMED');
    expect(codeOf(sign({ id: randomBytes(15) }))).toBe('MALFORMED');
    expect(codeOf(sign({}))).toBe('NO_ERROR');
  });

  it('never throws, and takes nothing but a signed server notice', () => {
    const opened = open(genuine('friendRequest'));
    const signed = opened.serverSignature;
    // A member's push, or a hand-made one claiming a signature it does not belong to.
    const member = openPush({
      recipient: bob,
      sealed: sealPush({
        recipient: recipientOf(bob),
        sender: alice,
        body: { kind: 'bump', circleId: ids.circle, ts: NOW },
      }),
      senderIdentityKey: () => alice.identity.publicKey,
    });
    expect(check(member)).toBeNull();
    expect(check({ ...member, serverSignature: signed })).toBeNull();
    expect(check({ ...opened, senderDeviceId: alice.deviceId })).toBeNull();
    expect(check({ ...opened, body: { kind: 'bump', circleId: ids.circle, ts: NOW } })).toBeNull();
    // A signature with one bit changed.
    if (signed === null) throw new Error('not signed');
    const flipped = signed.signature.slice();
    flipped[63] = (flipped[63] ?? 0) ^ 1;
    expect(check({ ...opened, serverSignature: { ...signed, signature: flipped } })).toBeNull();
    // Rubbish, a `seen` that fails, no `seen` at all.
    const input = { keys, now: NOW, maxAgeMs: HOUR };
    expect(verifyServerNotice({} as unknown as OpenedPush, input)).toBeNull();
    expect(
      verifyServerNotice(opened, {
        ...input,
        seen: () => {
          throw new Error('storage');
        },
      }),
    ).toBeNull();
    expect(verifyServerNotice(opened, input)).not.toBeNull();
  });

  it('holds only under a key the build trusts: production does not trust staging', () => {
    const production = parseNoticeKeys(`prd-n1:${noticePublicKey(randomBytes(32))}`);
    const opened = open(genuine('watch'));
    expect(verifyServerNotice(opened, { keys: production, now: NOW, maxAgeMs: HOUR })).toBeNull();
    expect(verifyServerNotice(opened, { keys: new Map(), now: NOW, maxAgeMs: HOUR })).toBeNull();
  });

  it('reads the trusted keys from the build, leaving out anything that is not a key', () => {
    // The identity point is a valid encoding but a small-order key: it would accept forgeries.
    const smallOrder = `AQ${'A'.repeat(41)}`;
    const parsed = parseNoticeKeys(
      ` stg-n1:${noticePublicKey(serverKey)},stg-n2:${smallOrder},Bad:${noticePublicKey(serverKey)},x`,
    );
    expect([...parsed.keys()]).toEqual(['stg-n1']);
  });

  it('stays well under what a push service carries', () => {
    const longest = PUSH_NOTICES.reduce((a, b) => (a.length >= b.length ? a : b));
    expect(genuine(longest).length).toBeLessThan(600);
  });
});

import { DOC_PADDED_BYTES, type DocPayload, type Payload } from '@bargu/schemas';
import { describe, expect, it } from 'vitest';

import { voteId } from '../src/documents.js';
import { utf8Encode } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import {
  createSenderState,
  decryptDocument,
  decryptMessage,
  decryptStoredMessage,
  encryptDocument,
  encryptMessage,
  encryptPaddedWith,
  verifyDocumentEnvelope,
  verifyMessageEnvelope,
} from '../src/message.js';
import { pad } from '../src/padding.js';
import { ReplayGuard } from '../src/replay.js';
import { generateSenderKey } from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const senderKey = generateSenderKey({
  circleId: ids.circle,
  epoch: 2,
  senderDeviceId: alice.deviceId,
});
const ts = 1_791_880_000_000;

const plan: DocPayload = {
  kind: 'plan',
  id: ids.circle,
  meetAt: ts + 3_600_000,
  placeId: ids.place,
  ts,
};
const vote: DocPayload = { kind: 'vote', id: ids.place, pollId: ids.place, choices: [0, 1], ts };
/** The largest document there is: four places whose names take three bytes per character. */
const largestPoll: DocPayload = {
  kind: 'poll',
  id: ids.place,
  by: ids.bobUser,
  about: 'place',
  options: [0, 1, 2, 3].map(() => ({ placeId: ids.place, name: '界'.repeat(40) })),
  closed: { choice: 3 },
  ts: Number.MAX_SAFE_INTEGER,
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const state = createSenderState(senderKey);
const seal = (payload: DocPayload) => encryptDocument({ state, sender: alice, payload }).envelope;
const open = (envelope: unknown) =>
  decryptDocument({ envelope, senderKey, sender: publicKeysOf(alice) });

describe('documents (docs/ADR/0018)', () => {
  it('opens a meeting, a poll and a vote again and again', () => {
    for (const payload of [plan, vote, largestPoll]) {
      const envelope = seal(payload);
      expect(open(envelope)).toEqual(payload);
      expect(open(envelope)).toEqual(payload);
    }
  });

  it('pads every document to the same size, larger than a message', () => {
    const sizes = [plan, vote, largestPoll].map((payload) => seal(payload).ct.length);
    expect(new Set(sizes).size).toBe(1);
    const message = encryptMessage({ state, sender: alice, payload: locationPayload }).envelope;
    expect(sizes[0]).toBeGreaterThan(message.ct.length);
  });

  it('keeps documents and messages apart, both ways', () => {
    const document = seal(plan);
    const message = encryptMessage({ state, sender: alice, payload: locationPayload }).envelope;
    expect(codeOf(() => open(message))).toBe('MALFORMED');
    expect(
      codeOf(() =>
        decryptMessage({
          envelope: document,
          senderKey,
          sender: publicKeysOf(alice),
          replay: new ReplayGuard(),
        }),
      ),
    ).toBe('MALFORMED');
    expect(
      codeOf(() =>
        decryptStoredMessage({ envelope: document, senderKey, sender: publicKeysOf(alice) }),
      ),
    ).toBe('MALFORMED');
    // Neither kind of payload goes into the other envelope.
    expect(
      codeOf(() =>
        encryptDocument({
          state,
          sender: alice,
          payload: locationPayload as unknown as DocPayload,
        }),
      ),
    ).toBe('MALFORMED');
    expect(
      codeOf(() => encryptMessage({ state, sender: alice, payload: plan as unknown as Payload })),
    ).toBe('MALFORMED');
  });

  it('lets the server check the author without opening anything', () => {
    const document = seal(vote);
    expect(verifyDocumentEnvelope(document, alice.identity.publicKey)).toBe(true);
    expect(verifyDocumentEnvelope(document, bob.identity.publicKey)).toBe(false);
    expect(verifyMessageEnvelope(document, alice.identity.publicKey)).toBe(false);
    const message = encryptMessage({ state, sender: alice, payload: locationPayload }).envelope;
    expect(verifyDocumentEnvelope(message, alice.identity.publicKey)).toBe(false);
  });

  it('still checks author, circle, epoch and signature', () => {
    const envelope = seal(plan);
    // Always a different first character: a fresh nonce changes the signature, and one in 64
    // already began with the "tampered" one (ci-linux, 2026-10-21).
    const tampered = (envelope.sig.startsWith('A') ? 'B' : 'A') + envelope.sig.slice(1);
    expect(codeOf(() => open({ ...envelope, sig: tampered }))).toBe('BAD_SIGNATURE');
    expect(codeOf(() => open({ ...envelope, epoch: 3 }))).toBe('KEY_MISMATCH');
    expect(codeOf(() => decryptDocument({ envelope, senderKey, sender: publicKeysOf(bob) }))).toBe(
      'KEY_MISMATCH',
    );
  });

  it('rejects a signed document whose content is not a document', () => {
    // A malicious member with a valid key: a message payload in a document envelope.
    const padded = pad(
      utf8Encode(JSON.stringify(locationPayload)),
      DOC_PADDED_BYTES,
      DOC_PADDED_BYTES,
    );
    const { envelope } = encryptPaddedWith({ state, sender: alice }, padded, new Uint8Array(16));
    expect(codeOf(() => open(envelope))).toBe('MALFORMED');
  });

  it("files a member's vote under one id per poll, the same on every phone of theirs", () => {
    const id = voteId(ids.place, ids.bobUser);
    // Pinned: every phone must derive the same id (docs/PROTOCOL.md). A version 8 UUID.
    expect(id).toBe('184a2c1c-e5f2-83f4-b40d-0492fa45c699');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(voteId(ids.place, ids.aliceUser)).not.toBe(id);
    expect(voteId(ids.circle, ids.bobUser)).not.toBe(id);
    expect(codeOf(() => voteId('poll', ids.bobUser))).toBe('MALFORMED');
  });
});

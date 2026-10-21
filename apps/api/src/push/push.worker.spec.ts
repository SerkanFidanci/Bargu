import {
  generateDeviceKeys,
  noticePublicKey,
  openPush,
  parseNoticeKeys,
  randomUuid,
  verifyServerNotice,
} from '@bargu/crypto';
import { PUSH_NOTICES } from '@bargu/schemas';
import { describe, expect, it } from 'vitest';

import type { PushJob } from './notifier.js';
import { sealedFor, ttlOf, WATCH_TTL_SECONDS } from './push.worker.js';
import type { PushTarget } from './push-tokens.js';

const recipient = generateDeviceKeys(randomUuid());
const circleId = randomUuid();
const target = (platform: PushTarget['platform']): PushTarget => ({
  userId: randomUuid(),
  deviceId: recipient.deviceId,
  dhKey: recipient.dh.publicKey,
  platform,
  token: 'device-token',
  locale: 'tr',
});
const watch: PushJob = { type: 'notice', userId: randomUuid(), notice: 'watch', circleId };
const NOW = 1_800_000_000_000;
// A throwaway notice key: some other device's identity secret will do as 32 random bytes.
const signer = { secretKey: generateDeviceKeys(randomUuid()).identity.secretKey, kid: 'stg-n1' };
const keys = parseNoticeKeys(`stg-n1:${noticePublicKey(signer.secretKey)}`);
const open = (sealed: string | null) =>
  openPush({ recipient, sealed: sealed ?? '', senderIdentityKey: () => null });

describe('the silent watch notice (docs/ADR/0028 step 3)', () => {
  it('is sealed for an Android phone as a server notice that names only the circle', () => {
    const sealed = sealedFor(watch, target('android'), null, NOW);
    expect(sealed).not.toBeNull();
    expect(open(sealed)).toEqual({
      senderDeviceId: null,
      body: { kind: 'notice', notice: 'watch', circleId, ts: NOW },
      serverSignature: null,
    });
  });

  it('is not sent to an iPhone, which would show the placeholder text for it', () => {
    expect(sealedFor(watch, target('ios'), signer)).toBeNull();
    // The other notices still reach it.
    expect(sealedFor({ ...watch, notice: 'circleInvite' }, target('ios'), signer)).not.toBeNull();
  });

  it('is kept by Google for two minutes at most, other notices for the usual hour', () => {
    expect(ttlOf(watch)).toBe(WATCH_TTL_SECONDS);
    expect(WATCH_TTL_SECONDS).toBeLessThanOrEqual(120);
    expect(ttlOf({ ...watch, notice: 'circleInvite' })).toBeUndefined();
    expect(
      ttlOf({ type: 'sealed', userId: randomUuid(), deviceId: randomUuid(), sealed: 'A' }),
    ).toBe(undefined);
  });
});

describe('server notices signed with the notice key (QA-28 B-1)', () => {
  it.each(PUSH_NOTICES)('signs %s for the target device, dated now', (notice) => {
    const opened = open(sealedFor({ ...watch, notice }, target('android'), signer, NOW));
    expect(opened.body).toEqual({ kind: 'notice', notice, circleId, ts: NOW });
    expect(opened.serverSignature).toMatchObject({ kid: 'stg-n1', issuedAt: NOW });
    expect(verifyServerNotice(opened, { keys, now: NOW, maxAgeMs: 60_000 })).not.toBeNull();
  });

  it('seals them unsigned when the server has no notice key', () => {
    const opened = open(sealedFor({ ...watch, notice: 'friendRequest' }, target('android'), null));
    expect(opened.serverSignature).toBeNull();
    expect(verifyServerNotice(opened, { keys, now: Date.now(), maxAgeMs: 60_000 })).toBeNull();
  });

  it('carries a member’s box as it is, and only to the device it was sealed for', () => {
    const job: PushJob = {
      type: 'sealed',
      userId: randomUuid(),
      deviceId: recipient.deviceId,
      sealed: 'AAAA',
    };
    expect(sealedFor(job, target('android'), signer)).toBe('AAAA');
    expect(sealedFor({ ...job, deviceId: randomUuid() }, target('android'), signer)).toBeNull();
  });
});

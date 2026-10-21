import { generateDeviceKeys, openPush, randomUuid } from '@bargu/crypto';
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

describe('the silent watch notice (docs/ADR/0028 step 3)', () => {
  it('is sealed for an Android phone as a server notice that names only the circle', () => {
    const sealed = sealedFor(watch, target('android'), 1_800_000_000_000);
    expect(sealed).not.toBeNull();
    const opened = openPush({
      recipient,
      sealed: sealed ?? '',
      senderIdentityKey: () => null,
    });
    expect(opened).toEqual({
      senderDeviceId: null,
      body: { kind: 'notice', notice: 'watch', circleId, ts: 1_800_000_000_000 },
    });
  });

  it('is not sent to an iPhone, which would show the placeholder text for it', () => {
    expect(sealedFor(watch, target('ios'))).toBeNull();
    // The other notices still reach it.
    expect(sealedFor({ ...watch, notice: 'circleInvite' }, target('ios'))).not.toBeNull();
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

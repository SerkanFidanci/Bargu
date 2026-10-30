import { describe, expect, it } from 'vitest';

import { chatPayloadSchema } from './chat.js';
import { CLIENT_LEVEL, CLIENT_LEVEL_FOR } from './client.js';
import { LIVE_EVENTS } from './event-names.js';
import { pushBodySchema } from './push.js';
import { ROLLCALL } from './rollcalls.js';

const id = '0190f7a4-3333-7333-8333-000000000001';
const rollcallId = '0190f7a4-3333-7333-8333-000000000002';
const circleId = '0190f7a4-3333-7333-8333-000000000003';
const ts = 1_791_880_000_000;

describe('an event roll call (docs/ADR/0040)', () => {
  it('asks with no words, and is answered with no location', () => {
    expect(
      chatPayloadSchema.safeParse({ kind: 'rollcall', id, closesAt: ts + ROLLCALL.openMs, ts })
        .success,
    ).toBe(true);
    expect(chatPayloadSchema.safeParse({ kind: 'here', id, rollcallId, ts }).success).toBe(true);
    // "Buradayım" is the person's word, never a place: a location in it is refused.
    expect(
      chatPayloadSchema.safeParse({ kind: 'here', id, rollcallId, ts, lat: 41, lng: 29 }).success,
    ).toBe(false);
    expect(
      chatPayloadSchema.safeParse({ kind: 'rollcall', id, closesAt: ts, ts, text: 'hey' }).success,
    ).toBe(false);
  });

  it('is told live and in a notification that names only the circle', () => {
    expect(LIVE_EVENTS).toContain('rollcall');
    expect(pushBodySchema.safeParse({ kind: 'rollcall', circleId, ts }).success).toBe(true);
    expect(pushBodySchema.safeParse({ kind: 'rollcall', circleId, ts, by: id }).success).toBe(
      false,
    );
  });

  it('keeps the PM’s numbers: ten minutes, six an hour, 15–17 in at most eight', () => {
    expect(ROLLCALL).toEqual({
      openMs: 600_000,
      perHour: 6,
      teenMaxMembers: 8,
      keepMs: 86_400_000,
    });
    expect(CLIENT_LEVEL).toBeGreaterThanOrEqual(CLIENT_LEVEL_FOR.rollcalls);
  });
});

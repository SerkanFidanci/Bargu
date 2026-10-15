import { describe, expect, it } from 'vitest';

import {
  HISTORY_PADDED_SIZES,
  HISTORY_SLOT_MS,
  historyEnvelopeSchema,
  historyQuerySchema,
  historySlot,
  MAX_TRAIL_POINTS,
  trailPayloadSchema,
} from './index.js';

const uuid = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));
const from = 1_791_880_200_000;

describe('location history (docs/ADR/0019)', () => {
  it('cuts time into quarter hours', () => {
    expect(from % HISTORY_SLOT_MS).toBe(0);
    expect(historySlot(from + HISTORY_SLOT_MS - 1)).toBe(from);
    expect(historySlot(from + HISTORY_SLOT_MS)).toBe(from + HISTORY_SLOT_MS);
  });

  it('keeps a quarter hour of points, about a metre apart at best', () => {
    const trail = {
      kind: 'trail',
      from,
      points: [
        [0, 4_100_823, 2_897_841, 12],
        [900, 4_101_000, 2_898_000, 8],
      ],
      ts: from + HISTORY_SLOT_MS,
    };
    expect(trailPayloadSchema.parse(trail)).toEqual(trail);
    for (const bad of [
      { ...trail, from: from + 1 },
      { ...trail, points: [] },
      { ...trail, points: [[901, 0, 0, 0]] },
      { ...trail, points: [[0, 9_000_001, 0, 0]] },
      { ...trail, points: [[0, 0, 0, 0.5]] },
      { ...trail, points: Array.from({ length: MAX_TRAIL_POINTS + 1 }, () => [0, 0, 0, 0]) },
    ]) {
      expect(trailPayloadSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('comes in three sizes only', () => {
    const envelope = {
      v: 1,
      circleId: uuid,
      epoch: 1,
      senderDeviceId: uuid,
      seq: 0,
      salt: b64(16),
      ct: b64(528),
      sig: b64(64),
    };
    for (const size of HISTORY_PADDED_SIZES) {
      expect(historyEnvelopeSchema.safeParse({ ...envelope, ct: b64(size + 16) }).success).toBe(
        true,
      );
    }
    expect(historyEnvelopeSchema.safeParse({ ...envelope, ct: b64(1040) }).success).toBe(false);
  });

  it('is asked for by time range', () => {
    expect(historyQuerySchema.parse({ from: '10', to: '20' })).toEqual({ from: 10, to: 20 });
    expect(historyQuerySchema.safeParse({ from: '20', to: '10' }).success).toBe(false);
  });
});

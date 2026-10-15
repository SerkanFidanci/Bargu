import {
  createSenderState,
  decryptHistory,
  encryptHistory,
  generateSenderKey,
  historyKeyOf,
  type SenderState,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  HISTORY_KEEP_MS,
  HISTORY_SLOT_MS,
  type HistoryRecord,
  historySlot,
  type Invite,
  type MessageEnvelope,
  type TrailPayload,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EventsService } from '../../src/events/events.service.js';
import { HistorySweeper } from '../../src/history/history-sweeper.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person, consentToHistory } from './support/people.js';

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

/** A member's phone: its sender key for the circle's epoch, sequence numbers kept. */
function phone(who: Person, circle: Pick<Circle, 'id' | 'epoch'>) {
  let state: SenderState = createSenderState(
    generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    }),
  );
  return {
    key: state.senderKey,
    seal(trail: TrailPayload): MessageEnvelope {
      const { envelope, nextState } = encryptHistory({ state, sender: who.device, payload: trail });
      state = nextState;
      return envelope;
    },
  };
}

// The tests prove the positions never reach the server in any form.
const trailAt = (from: number): TrailPayload => ({
  kind: 'trail',
  from,
  points: [
    [0, 4_100_823, 2_897_841, 9],
    [300, 4_101_204, 2_898_377, 7],
  ],
  ts: from + HISTORY_SLOT_MS,
});

/** Saves a piece as the app does: with the consent it asks for first (docs/ADR/0022). */
const consented = new Set<string>();
const put = async (who: Person, circleId: string, slot: number, envelope: MessageEnvelope) => {
  if (!consented.has(who.userId)) {
    await consentToHistory(test, who);
    consented.add(who.userId);
  }
  return as(test, who, 'PUT', `/v1/circles/${circleId}/history/${String(slot)}`, { envelope });
};

const list = async (
  who: Person,
  circleId: string,
  userId: string,
  from = Date.now() - 24 * 3_600_000,
  to = Date.now() + HISTORY_SLOT_MS,
) =>
  (
    await as(
      test,
      who,
      'GET',
      `/v1/circles/${circleId}/history/${userId}?from=${String(from)}&to=${String(to)}`,
    )
  ).json<{ chunks: HistoryRecord[] }>().chunks;

const lastSlot = () => historySlot(Date.now()) - HISTORY_SLOT_MS;

/** A circle whose members joined an hour ago (history shows only what came after joining). */
async function circleOf(owner: Person, ...members: Person[]): Promise<Circle> {
  const circle = await circleWith(test, owner, ...members);
  await test.admin.query(
    `UPDATE app.circle_members SET joined_at = now() - interval '1 hour' WHERE circle_id = $1`,
    [circle.id],
  );
  return circle;
}

describe('location history', () => {
  it('is kept as ciphertext per quarter hour, and opened by members with the history key', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleOf(ayse, bora);
    const aysePhone = phone(ayse, circle);
    const slot = lastSlot();
    const live = vi.spyOn(test.app.get(EventsService), 'emitLive');

    expect((await put(ayse, circle.id, slot, aysePhone.seal(trailAt(slot)))).statusCode).toBe(204);
    // Bora's screen hears about it at once, naming no place.
    expect(live).toHaveBeenCalledWith([bora.userId], 'history', {
      circleId: circle.id,
      userId: ayse.userId,
    });
    live.mockRestore();

    const [record] = await list(bora, circle.id, ayse.userId);
    const author = circle.members.find((member) => member.userId === ayse.userId)?.device;
    if (record === undefined || author === undefined || author === null) throw new Error('missing');
    expect(record).toMatchObject({ userId: ayse.userId, from: slot });
    expect(
      decryptHistory({
        envelope: record.envelope,
        historyKey: historyKeyOf(aysePhone.key),
        sender: verifyDeviceKeyBundle(author.bundle),
      }),
    ).toEqual(trailAt(slot));
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT row_to_json(h)::text AS dump FROM app.history_chunks h WHERE circle_id = $1`,
      [circle.id],
    );
    for (const text of ['4100823', '2897841', '41.008', 'points', 'trail']) {
      expect(rows.map((row) => row.dump).join()).not.toContain(text);
    }

    // The same quarter hour again replaces it (a phone sending what waited twice).
    expect((await put(ayse, circle.id, slot, aysePhone.seal(trailAt(slot)))).statusCode).toBe(204);
    expect(await list(bora, circle.id, ayse.userId)).toHaveLength(1);
  });

  it('shows members only what came after they joined', async () => {
    const [ayse, bora, can] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleOf(ayse, bora);
    const slot = lastSlot();
    await put(ayse, circle.id, slot, phone(ayse, circle).seal(trailAt(slot)));

    // Can joins now: the quarter hour before is not his to see.
    const qr = (
      await as(test, ayse, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
    ).json<Invite>();
    expect(
      (await as(test, can, 'POST', '/v1/invites/accept', { token: qr.token })).statusCode,
    ).toBe(200);
    expect(await list(can, circle.id, ayse.userId)).toEqual([]);
    expect(await list(bora, circle.id, ayse.userId)).toHaveLength(1);
  });

  it('refuses pieces not signed by the caller, for another circle, at odd or old times', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleOf(ayse, bora);
    const other = await circleOf(ayse, bora);
    const slot = lastSlot();
    const cases: [number, MessageEnvelope][] = [
      [slot, phone(bora, circle).seal(trailAt(slot))],
      [slot, phone(ayse, other).seal(trailAt(slot))],
      [slot + 1, phone(ayse, circle).seal(trailAt(slot))],
      [slot + 2 * HISTORY_SLOT_MS, phone(ayse, circle).seal(trailAt(slot))],
      [
        historySlot(Date.now() - HISTORY_KEEP_MS) - HISTORY_SLOT_MS,
        phone(ayse, circle).seal(trailAt(slot)),
      ],
    ];
    for (const [at, envelope] of cases) {
      expect((await put(ayse, circle.id, at, envelope)).statusCode).toBe(400);
    }
    // An epoch that has not begun.
    const future = await put(
      ayse,
      circle.id,
      slot,
      phone(ayse, { ...circle, epoch: circle.epoch + 1 }).seal(trailAt(slot)),
    );
    expect(future.json()).toMatchObject({ code: 'EPOCH_STALE' });
    expect(await list(bora, circle.id, ayse.userId)).toEqual([]);
  });

  it('is invisible outside the circle, deleted by its owner, and leaves with them', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleOf(ayse, bora);
    const slot = lastSlot();
    await put(ayse, circle.id, slot, phone(ayse, circle).seal(trailAt(slot)));
    await put(bora, circle.id, slot, phone(bora, circle).seal(trailAt(slot)));

    expect(await list(mallory, circle.id, ayse.userId)).toEqual([]);
    const intrude = await put(mallory, circle.id, slot, phone(mallory, circle).seal(trailAt(slot)));
    expect(intrude.statusCode).toBe(404);
    // Mallory's "delete" touches nothing of theirs.
    await as(test, mallory, 'DELETE', `/v1/circles/${circle.id}/history`);
    expect(await list(bora, circle.id, ayse.userId)).toHaveLength(1);

    // Ayşe deletes hers; Bora leaves and his goes with him.
    expect((await as(test, ayse, 'DELETE', `/v1/circles/${circle.id}/history`)).statusCode).toBe(
      204,
    );
    expect(await list(bora, circle.id, ayse.userId)).toEqual([]);
    await as(test, bora, 'POST', `/v1/circles/${circle.id}/leave`);
    const { rows } = await test.admin.query(
      `SELECT 1 FROM app.history_chunks WHERE circle_id = $1`,
      [circle.id],
    );
    expect(rows).toEqual([]);
  });

  it('goes after two weeks', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleOf(ayse, bora);
    const slot = lastSlot();
    await put(ayse, circle.id, slot, phone(ayse, circle).seal(trailAt(slot)));
    // The same piece as if it were fifteen days old (the server refuses to take one that old).
    await test.admin.query(
      `INSERT INTO app.history_chunks (circle_id, user_id, slot, envelope)
       SELECT circle_id, user_id, slot - interval '15 days', envelope FROM app.history_chunks
        WHERE circle_id = $1`,
      [circle.id],
    );
    const sweeper = new HistorySweeper(
      test.app.get(DatabaseService),
      test.app.get<RedisClient>(REDIS),
    );
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    const { rows } = await test.admin.query<{ slot: Date }>(
      `SELECT slot FROM app.history_chunks WHERE circle_id = $1`,
      [circle.id],
    );
    expect(rows.map((row) => row.slot.getTime())).toEqual([slot]);
  });

  it('gives a day or two at a time, and not without end (QA Faz 8 G3)', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleOf(ayse, bora);
    const now = Date.now();
    const ask = (from: number, to: number) =>
      as(
        test,
        bora,
        'GET',
        `/v1/circles/${circle.id}/history/${ayse.userId}?from=${String(from)}&to=${String(to)}`,
      );
    expect((await ask(now - 3 * 24 * 3_600_000, now)).statusCode).toBe(400);
    expect((await ask(now - 2 * 24 * 3_600_000, now)).statusCode).toBe(200);
    let refused = 0;
    for (let i = 0; i < 31; i++) {
      if ((await ask(now - 3_600_000, now)).statusCode === 429) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
  });
});

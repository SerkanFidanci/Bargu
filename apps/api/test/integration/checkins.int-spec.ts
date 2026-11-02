import { type DevicePublicKeys, openDirect, randomUuid, sealDirect } from '@bargu/crypto';
import {
  CHECKIN,
  CHECKIN_LIMITS,
  type ChatPayload,
  type CheckinInbox,
  type CheckinList,
  type CheckinReply,
} from '@bargu/schemas';
import { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CheckinWorker } from '../../src/checkins/checkin-worker.js';
import { EventsService } from '../../src/events/events.service.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { EmailJobs } from '../../src/jobs/email-jobs.js';
import { JOB_QUEUE } from '../../src/jobs/tokens.js';
import { MessagesSweeper } from '../../src/messages/messages-sweeper.js';
import { Notifier } from '../../src/push/notifier.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;
let owner: Person;
let ayse: Person;
let can: Person;
let stranger: Person;

beforeAll(async () => {
  test = await createTestApp();
  [owner, ayse, can, stranger] = await Promise.all([
    person(test, 'Ali'),
    person(test, 'Ayşe'),
    person(test, 'Can'),
    person(test, 'Yabancı'),
  ]);
  await circleWith(test, owner, ayse, can);
});
afterAll(async () => {
  await test.close();
});

const HOUR = 3_600_000;
const keysOf = (who: Person): DevicePublicKeys => ({
  deviceId: who.device.deviceId,
  identityKey: who.device.identity.publicKey,
  dhKey: who.device.dh.publicKey,
});

const alert = (id: string, due: number, seq = 0): ChatPayload => ({
  kind: 'checkin',
  id,
  due,
  grace: 10,
  place: { name: 'Ev', emoji: '🏠' },
  last: { lat: 41.0256, lng: 28.9742, acc: 12, ts: Date.now() },
  bat: 40,
  chg: false,
  seq,
  ts: Date.now(),
});
/** One sealed box for each recipient, from `from`'s device. */
const boxesFor = (from: Person, id: string, due: number, to: Person[], seq = 0) =>
  to.map((recipient) => ({
    recipientId: recipient.userId,
    box: sealDirect({
      sender: from.device,
      recipient: keysOf(recipient),
      payload: alert(id, due, seq),
    }),
  }));

const create = (who: Person, body: object) =>
  as(test, who, 'POST', '/v1/checkins', body).then((r) => r.json<CheckinReply>());
const refresh = (who: Person, id: string, body: object) =>
  as(test, who, 'PUT', `/v1/checkins/${id}/boxes`, body).then((r) => r.json<CheckinReply>());
const extend = (who: Person, id: string, body: object) =>
  as(test, who, 'POST', `/v1/checkins/${id}/extend`, body).then((r) => r.json<CheckinReply>());
const cancel = (who: Person, id: string) =>
  as(test, who, 'DELETE', `/v1/checkins/${id}`).then((r) => r.json<CheckinReply>());
const inbox = async (who: Person) =>
  (await as(test, who, 'GET', '/v1/checkins/inbox')).json<CheckinInbox>().alerts;
const mine = async (who: Person) =>
  (await as(test, who, 'GET', '/v1/checkins')).json<CheckinList>().checkins;

/** A check set for an hour from now, to Ayşe and Can. */
async function setOne(due = Date.now() + HOUR) {
  const id = randomUuid();
  const openAt = due + 10 * 60_000;
  expect(await create(owner, { id, openAt, boxes: boxesFor(owner, id, due, [ayse, can]) })).toEqual(
    { ok: true },
  );
  return { id, due, openAt };
}

const worker = () =>
  new CheckinWorker(
    test.app.get(DatabaseService),
    test.app.get<PgBoss>(JOB_QUEUE),
    test.app.get(EventsService),
    test.app.get(Notifier),
  );
/** Its time has come (the job would fire it now). */
async function due(id: string) {
  await test.admin.query(
    `UPDATE app.checkins SET created_at = now() - interval '2 hours',
       open_at = now() - interval '1 second' WHERE id = $1`,
    [id],
  );
}

describe('an arrival check, the sealed escrow (docs/ADR/0039)', () => {
  it('is kept unread, and nobody gets a box before its time', async () => {
    const { id } = await setOne();
    // Recipients see nothing yet; a stranger cannot touch it.
    expect(await inbox(ayse)).toEqual([]);
    expect(
      await refresh(stranger, id, { boxes: boxesFor(stranger, id, Date.now(), [ayse]) }),
    ).toEqual({ refused: 'NOT_FOUND' });
    expect(await cancel(stranger, id)).toEqual({ ok: true });
    expect((await mine(owner)).find((check) => check.id === id)?.recipients.sort()).toEqual(
      [ayse.userId, can.userId].sort(),
    );
    expect(await mine(stranger)).toEqual([]);
    const rows = await test.admin.query(`SELECT count(*) AS n FROM app.checkins WHERE id = $1`, [
      id,
    ]);
    expect(rows.rows[0]).toEqual({ n: '1' });
    await cancel(owner, id);
  });

  it('is refused one answer for every recipient it cannot go to', async () => {
    const id = randomUuid();
    const due = Date.now() + HOUR;
    const openAt = due + 10 * 60_000;
    // No circle shared with the stranger.
    expect(
      await create(owner, { id, openAt, boxes: boxesFor(owner, id, due, [stranger]) }),
    ).toEqual({ refused: 'RECIPIENT' });
    // Blocked, either way: the same answer.
    await as(test, can, 'PUT', `/v1/blocks/${owner.userId}`);
    try {
      expect(await create(owner, { id, openAt, boxes: boxesFor(owner, id, due, [can]) })).toEqual({
        refused: 'RECIPIENT',
      });
    } finally {
      await as(test, can, 'DELETE', `/v1/blocks/${owner.userId}`);
    }
    // A box sealed by another device is no box of this person's.
    expect(await create(owner, { id, openAt, boxes: boxesFor(stranger, id, due, [ayse]) })).toEqual(
      { refused: 'INVALID' },
    );
  });

  it('opens between five minutes and 23 hours ahead, three at a time', async () => {
    const id = randomUuid();
    const soon = Date.now() + 60_000;
    expect(
      await create(owner, { id, openAt: soon, boxes: boxesFor(owner, id, soon, [ayse]) }),
    ).toEqual({ refused: 'TIME' });
    const far = Date.now() + CHECKIN.maxAheadMs + HOUR;
    expect(
      await create(owner, { id, openAt: far, boxes: boxesFor(owner, id, far, [ayse]) }),
    ).toEqual({
      refused: 'TIME',
    });
    const set = [];
    for (let n = 0; n < CHECKIN_LIMITS.maxActive; n += 1) set.push(await setOne());
    const extra = randomUuid();
    const later = Date.now() + 2 * HOUR;
    expect(
      await create(owner, {
        id: extra,
        openAt: later,
        boxes: boxesFor(owner, extra, later, [ayse]),
      }),
    ).toEqual({ refused: 'TOO_MANY' });
    for (const check of set) await cancel(owner, check.id);
  });

  it('is refreshed for the same people at most every two minutes, never moved but by its owner', async () => {
    const { id, due } = await setOne();
    // Too soon after it was set.
    expect(await refresh(owner, id, { boxes: boxesFor(owner, id, due, [ayse, can], 1) })).toEqual({
      refused: 'RATE_LIMITED',
    });
    await test.admin.query(
      `UPDATE app.checkins SET updated_at = now() - interval '3 minutes' WHERE id = $1`,
      [id],
    );
    // Not for other people.
    expect(await refresh(owner, id, { boxes: boxesFor(owner, id, due, [ayse], 1) })).toEqual({
      refused: 'RECIPIENT',
    });
    expect(await refresh(owner, id, { boxes: boxesFor(owner, id, due, [ayse, can], 1) })).toEqual({
      ok: true,
    });
    // The owner moves it later, once more; a stranger cannot.
    const later = due + HOUR;
    expect(
      await extend(stranger, id, {
        openAt: later + 600_000,
        boxes: boxesFor(stranger, id, later, [ayse]),
      }),
    ).toEqual({ refused: 'NOT_FOUND' });
    expect(
      await extend(owner, id, {
        openAt: later + 600_000,
        boxes: boxesFor(owner, id, later, [ayse, can]),
      }),
    ).toEqual({ ok: true });
    expect((await mine(owner)).find((check) => check.id === id)?.openAt).toBe(later + 600_000);
    await cancel(owner, id);
  });

  it('cancelled before its time, is gone for good and never fires', async () => {
    const { id } = await setOne();
    expect(await cancel(owner, id)).toEqual({ ok: true });
    const rows = await test.admin.query(
      `SELECT (SELECT count(*) FROM app.checkins WHERE id = $1) AS checks,
              (SELECT count(*) FROM app.checkin_boxes WHERE checkin_id = $1) AS boxes`,
      [id],
    );
    expect(rows.rows[0]).toEqual({ checks: '0', boxes: '0' });
    expect(await worker().fire(id)).toBeNull();
  });

  it('fires at its time: each recipient gets their own box, a notice with nothing in it, and can say "Gördüm"', async () => {
    const notify = vi.spyOn(test.app.get(Notifier), 'notify');
    const publish = vi.spyOn(test.app.get(EventsService), 'publish');
    const { id } = await setOne();
    // Not yet its time: nothing fires.
    expect(await worker().fire(id)).toBeNull();
    await due(id);
    expect(await worker().fire(id)).toBe(2);
    expect(notify).toHaveBeenCalledWith(
      expect.arrayContaining([ayse.userId, can.userId]),
      'checkin',
      id,
    );
    expect(publish).toHaveBeenCalledWith(expect.arrayContaining([owner.userId, ayse.userId]), {
      type: 'checkin.fired',
      checkinId: id,
      ownerId: owner.userId,
    });
    // Fired once only.
    expect(await worker().fire(id)).toBeNull();
    const [mineAlert] = await inbox(ayse);
    expect(mineAlert?.checkinId).toBe(id);
    expect(mineAlert?.ownerId).toBe(owner.userId);
    // Only Ayşe's device opens Ayşe's box; Can has his own.
    const opened = openDirect({
      envelope: mineAlert?.box,
      recipient: ayse.device,
      sender: keysOf(owner),
      now: Date.now(),
    });
    expect(opened).toMatchObject({ kind: 'checkin', id });
    expect(await inbox(stranger)).toEqual([]);
    // Cancelling after it fired leaves it with its recipients.
    expect(await cancel(owner, id)).toEqual({ refused: 'FIRED' });
    expect((await mine(owner)).find((check) => check.id === id)?.firedAt).not.toBeNull();
    // "Gördüm": Ayşe's box goes; with the last box, the check.
    await as(test, ayse, 'POST', `/v1/checkins/${id}/ack`);
    expect(await inbox(ayse)).toEqual([]);
    expect((await inbox(can)).map((one) => one.checkinId)).toEqual([id]);
    await as(test, can, 'POST', `/v1/checkins/${id}/ack`);
    const rows = await test.admin.query(`SELECT count(*) AS n FROM app.checkins WHERE id = $1`, [
      id,
    ]);
    expect(rows.rows[0]).toEqual({ n: '0' });
    notify.mockRestore();
    publish.mockRestore();
  });

  it('drops the box of a recipient blocked since, unseen', async () => {
    const { id } = await setOne();
    await as(test, can, 'PUT', `/v1/blocks/${owner.userId}`);
    try {
      await due(id);
      expect(await worker().fire(id)).toBe(1);
      expect(await inbox(can)).toEqual([]);
    } finally {
      await as(test, can, 'DELETE', `/v1/blocks/${owner.userId}`);
    }
    await as(test, ayse, 'POST', `/v1/checkins/${id}/ack`);
  });

  it('counts the checks set in a day, cancelled or not, and never sets a cancelled one again (QA-44)', async () => {
    // Ayşe's own day (Ali's checks in this file count towards his).
    const setBy = async (id = randomUuid()) => {
      const due = Date.now() + HOUR;
      const reply = await create(ayse, {
        id,
        openAt: due + 10 * 60_000,
        boxes: boxesFor(ayse, id, due, [can]),
      });
      return { id, reply };
    };
    const first = await setBy();
    expect(first.reply).toEqual({ ok: true });
    // The answer was lost and the phone asks again with the same id: the same check, once.
    expect((await setBy(first.id)).reply).toEqual({ ok: true });
    expect((await mine(ayse)).filter((check) => check.id === first.id)).toHaveLength(1);
    expect(await cancel(ayse, first.id)).toEqual({ ok: true });
    // A late copy of that request, after the cancel: not set again.
    expect((await setBy(first.id)).reply).toEqual({ refused: 'NOT_FOUND' });
    expect(await mine(ayse)).toEqual([]);
    // Someone else with that id: refused like any other.
    const due = Date.now() + HOUR;
    expect(
      await create(can, {
        id: first.id,
        openAt: due + 10 * 60_000,
        boxes: boxesFor(can, first.id, due, [ayse]),
      }),
    ).toEqual({ refused: 'INVALID' });
    // Set and cancelled, again and again: the day's limit still holds.
    for (let n = 1; n < CHECKIN_LIMITS.perDay; n += 1) {
      const next = await setBy();
      expect(next.reply).toEqual({ ok: true });
      await cancel(ayse, next.id);
    }
    expect((await setBy()).reply).toEqual({ refused: 'DAILY_LIMIT' });
    // Only the id, its owner and when, and for a day.
    const { rows } = await test.admin.query<Record<string, unknown>>(
      `SELECT * FROM app.checkin_setups WHERE owner_id = $1`,
      [ayse.userId],
    );
    expect(rows).toHaveLength(CHECKIN_LIMITS.perDay);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['created_at', 'id', 'owner_id']);
    await test.admin.query(
      `UPDATE app.checkin_setups SET created_at = now() - interval '25 hours' WHERE owner_id = $1`,
      [ayse.userId],
    );
    await new MessagesSweeper(
      test.app.get(DatabaseService),
      test.app.get<RedisClient>(REDIS),
      test.app.get(EmailJobs),
      test.env,
    ).sweep();
    const left = await test.admin.query(
      `SELECT count(*) AS n FROM app.checkin_setups WHERE owner_id = $1`,
      [ayse.userId],
    );
    expect(left.rows[0]).toEqual({ n: '0' });
    // The app's own role reads none of it.
    const app = new Pool({ connectionString: test.env.DATABASE_URL, max: 1 });
    try {
      await expect(app.query(`SELECT * FROM app.checkin_setups`)).rejects.toThrow(/permission/);
    } finally {
      await app.end();
    }
  });

  it('is fired by the next round when no job did, and deleted a day after it fired', async () => {
    const { id } = await setOne();
    await test.admin.query(
      `UPDATE app.checkins SET created_at = now() - interval '2 hours',
         open_at = now() - interval '5 minutes' WHERE id = $1`,
      [id],
    );
    await worker().catchUp();
    expect((await inbox(ayse)).map((one) => one.checkinId)).toContain(id);
    await test.admin.query(
      `UPDATE app.checkins SET fired_at = now() - interval '25 hours' WHERE id = $1`,
      [id],
    );
    await new MessagesSweeper(
      test.app.get(DatabaseService),
      test.app.get<RedisClient>(REDIS),
      test.app.get(EmailJobs),
      test.env,
    ).sweep();
    const rows = await test.admin.query(
      `SELECT (SELECT count(*) FROM app.checkins WHERE id = $1) AS checks,
              (SELECT count(*) FROM app.checkin_boxes WHERE checkin_id = $1) AS boxes`,
      [id],
    );
    expect(rows.rows[0]).toEqual({ checks: '0', boxes: '0' });
  });
});

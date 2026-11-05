import { chatPayloadSchema } from '@bargu/schemas';

import { lastCallDue } from '../location/last-call';
import type { Fix } from '../location/send';
import type { KeyValueStore } from '../storage/vault';
import { whyShown } from '../location/why';
import {
  alertOf,
  automaticArrivalEnabled,
  type CheckPlan,
  hasArrived,
  nextDue,
  openAtOf,
  type OwnCheck,
  receivedOf,
  refreshDue,
} from './checkin-model';

const NOW = new Date(2026, 9, 30, 21, 0).getTime();
const MINUTE = 60_000;
const home = { name: 'Ev', emoji: '🏠', lat: 41.0256, lng: 28.9742, radius: 150 };
const check: OwnCheck = {
  id: '0190f7a4-0000-7000-8000-000000000001',
  due: NOW + 30 * MINUTE,
  grace: 10,
  place: home,
  recipients: ['0190f7a4-0000-7000-8000-000000000002'],
  note: 'Taksi 34 ABC 123',
  seq: 2,
  createdAt: NOW - MINUTE,
  extends: 0,
  sentAt: NOW - MINUTE,
  state: 'armed',
};
const fix = (over: Partial<Fix> = {}): Fix => ({
  lat: home.lat,
  lng: home.lng,
  acc: 20,
  spd: 0,
  hdg: null,
  ts: NOW,
  ...over,
});

describe('an arrival check on the phone (docs/ADR/0039)', () => {
  it('promises automatic arrival only after location permission is granted', () => {
    expect(automaticArrivalEnabled('unknown')).toBe(false);
    expect(automaticArrivalEnabled('undetermined')).toBe(false);
    expect(automaticArrivalEnabled('blocked')).toBe(false);
    expect(automaticArrivalEnabled('granted')).toBe(true);
  });

  it('arrives only with a fresh, sharp position inside the place', () => {
    expect(hasArrived(check, fix(), NOW)).toBe(true);
    // Old, coarse, or 300 m away: not arrived (and never "did not arrive").
    expect(hasArrived(check, fix({ ts: NOW - 3 * MINUTE }), NOW)).toBe(false);
    expect(hasArrived(check, fix({ acc: 500 }), NOW)).toBe(false);
    expect(hasArrived(check, fix({ lat: home.lat + 0.003 }), NOW)).toBe(false);
    // No place: only "Vardım" by hand.
    expect(hasArrived({ place: null }, fix(), NOW)).toBe(false);
  });

  it('is refreshed every 5 minutes moving and 15 still', () => {
    expect(refreshDue({ sentAt: NOW - 4 * MINUTE }, true, NOW)).toBe(false);
    expect(refreshDue({ sentAt: NOW - 5 * MINUTE }, true, NOW)).toBe(true);
    expect(refreshDue({ sentAt: NOW - 10 * MINUTE }, false, NOW)).toBe(false);
    expect(refreshDue({ sentAt: NOW - 15 * MINUTE }, false, NOW)).toBe(true);
  });

  it('seals the place by name only, with the last location, battery and note', () => {
    const alert = alertOf(check, fix({ acc: 12.4 }), { level: 3.4, charging: false }, NOW);
    expect(chatPayloadSchema.safeParse(alert).success).toBe(true);
    expect(alert.place).toEqual({ name: 'Ev', emoji: '🏠' });
    expect(JSON.stringify(alert.place)).not.toContain('41.0256');
    expect(alert).toMatchObject({ due: check.due, grace: 10, bat: 3, chg: false, seq: 2 });
    expect(alert.last).toEqual({ lat: home.lat, lng: home.lng, acc: 12, ts: NOW });
    const withoutNote: OwnCheck = { ...check };
    delete withoutNote.note;
    expect(alertOf(withoutNote, null, null, NOW)).toMatchObject({
      last: null,
      bat: null,
      chg: null,
    });
  });

  it("sets a repeated plan's next day between 5 minutes and 23 hours ahead, once", () => {
    const plan: CheckPlan = {
      id: 'p',
      days: [1, 2, 3, 4, 5],
      at: '23:30',
      grace: 10,
      place: home,
      recipients: [],
      lastDue: null,
      skip: [],
    };
    // Friday 30 October, 21:00: tonight's 23:30.
    const tonight = new Date(2026, 9, 30, 23, 30).getTime();
    expect(nextDue(plan, NOW)).toBe(tonight);
    // Already set: nothing more today, and Saturday is not a weekday.
    expect(nextDue({ ...plan, lastDue: tonight }, NOW)).toBeNull();
    // Skipped: nothing.
    expect(nextDue({ ...plan, skip: [tonight] }, NOW)).toBeNull();
    // Too close to set (open within 5 minutes): not tonight.
    const late = new Date(2026, 9, 30, 23, 36).getTime();
    expect(nextDue(plan, late)).toBeNull();
  });

  it('tells a recipient when an alert came before its own time', () => {
    const opened = alertOf(check, fix(), { level: 40, charging: true }, NOW);
    const meta = { checkinId: check.id, ownerId: 'o', firedAt: NOW };
    expect(receivedOf(opened, meta, NOW).early).toBe(true);
    expect(receivedOf(opened, meta, openAtOf(check.due, check.grace)).early).toBe(false);
  });
});

describe('the last location before the battery dies (N1, docs/ADR/0039 §9)', () => {
  const store = (): KeyValueStore => {
    const data = new Map<string, string>();
    return {
      get: (key) => data.get(key),
      set: (key, value) => {
        data.set(key, value);
      },
      delete: (key) => {
        data.delete(key);
      },
      keys: () => [...data.keys()],
      clear: () => {
        data.clear();
      },
    };
  };

  it('goes once at 5% or less, not charging, and again only after a charge above 15%', () => {
    const vault = store();
    expect(lastCallDue(vault, { level: 6, charging: false })).toBe(false);
    expect(lastCallDue(vault, { level: 5, charging: false })).toBe(true);
    expect(lastCallDue(vault, { level: 4, charging: false })).toBe(false);
    expect(lastCallDue(vault, { level: 3, charging: true })).toBe(false);
    expect(lastCallDue(vault, { level: 3, charging: false })).toBe(false);
    expect(lastCallDue(vault, { level: 20, charging: false })).toBe(false);
    expect(lastCallDue(vault, { level: 4, charging: false })).toBe(true);
  });

  it('lets a friend read "Pili bitmek üzereydi" from an old location sent nearly empty', () => {
    const old = NOW - 23 * MINUTE;
    expect(whyShown({ loc: { ts: old, bat: 3, chg: false }, state: undefined, now: NOW })).toEqual({
      kind: 'lowBattery',
      since: old,
    });
    // Charging, or still fresh: not that.
    expect(
      whyShown({ loc: { ts: old, bat: 3, chg: true }, state: undefined, now: NOW })?.kind,
    ).toBe('offline');
    expect(
      whyShown({ loc: { ts: NOW, bat: 3, chg: false }, state: undefined, now: NOW }),
    ).toBeNull();
  });
});

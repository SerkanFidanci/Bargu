import { applyPrecision, type DeviceKeys, encryptMessage } from '@bargu/crypto';
import type { Circle, LocPayload, MessageEnvelope } from '@bargu/schemas';

import type { KeyStore } from '../keys/key-store';
import { circleSharing, type SharingSettings, sharedCircles } from './sharing';

/** One position from the phone's location service. */
export interface Fix {
  lat: number;
  lng: number;
  /** Accuracy radius in metres. */
  acc: number;
  /** m/s; null when the platform does not know. */
  spd: number | null;
  /** Degrees from north; null when unknown or not moving. */
  hdg: number | null;
  ts: number;
}

export interface Battery {
  /** 0–100. */
  level: number;
  charging: boolean;
}

/** BARGU_PLAN §3.3 frequency table. */
export const SEND_RULES = {
  /** Someone watches on their map: about once a second. */
  liveIntervalMs: 900,
  /** Otherwise: at most every 5 s, and only after moving 10 m… */
  movingIntervalMs: 5_000,
  movingDistanceM: 10,
  /** …or a heartbeat every 5 minutes while still (battery, "still here"). */
  heartbeatMs: 5 * 60_000,
} as const;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: Pick<Fix, 'lat' | 'lng'>, b: Pick<Fix, 'lat' | 'lng'>): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LastSent {
  fix: Fix;
  sentAt: number;
}

/** Whether a new fix is worth sending (battery and the relay's rate limit both care). */
export function shouldSend(last: LastSent | null, fix: Fix, now: number, live: boolean): boolean {
  if (last === null) return true;
  const elapsed = now - last.sentAt;
  if (live) return elapsed >= SEND_RULES.liveIntervalMs;
  if (elapsed >= SEND_RULES.heartbeatMs) return true;
  return (
    elapsed >= SEND_RULES.movingIntervalMs && distanceM(last.fix, fix) >= SEND_RULES.movingDistanceM
  );
}

/** The location message before precision is applied; odd platform values are left out. */
export function locPayload(fix: Fix, battery: Battery, since?: number): LocPayload {
  const payload: LocPayload = {
    kind: 'loc',
    lat: fix.lat,
    lng: fix.lng,
    acc: Math.min(Math.max(fix.acc, 0), 1_000_000),
    bat: Math.round(Math.min(Math.max(battery.level, 0), 100)),
    chg: battery.charging,
    ts: fix.ts,
  };
  if (fix.spd !== null && fix.spd >= 0 && fix.spd <= 1_000) payload.spd = fix.spd;
  if (fix.hdg !== null && fix.hdg >= 0 && fix.hdg < 360) payload.hdg = fix.hdg;
  if (since !== undefined && since <= fix.ts) payload.since = since;
  return payload;
}

/**
 * One envelope per circle this phone shares with: the position coarsened to that circle's
 * precision first (on the phone, before encryption), then encrypted and signed with this
 * device's sender key for the circle's epoch. The sequence number is reserved before encrypting.
 */
export function buildEnvelopes(input: {
  fix: Fix;
  battery: Battery;
  circles: readonly Pick<Circle, 'id' | 'epoch' | 'myStatus'>[];
  settings: SharingSettings;
  keys: KeyStore;
  device: DeviceKeys;
  now: number;
  /** Since when this phone has stayed where it is (stay.ts). */
  since?: number;
}): MessageEnvelope[] {
  const full = locPayload(input.fix, input.battery, input.since);
  return sharedCircles(input.circles, input.settings, input.now).map((circle) => {
    const payload = applyPrecision(full, circleSharing(input.settings, circle.id).precision);
    const senderKey = input.keys.ownKey(circle);
    const nextSeq = input.keys.reserveSeq(circle);
    return encryptMessage({ state: { senderKey, nextSeq }, sender: input.device, payload })
      .envelope;
  });
}

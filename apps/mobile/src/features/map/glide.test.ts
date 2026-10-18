import { glide } from '@/theme/motion';

import {
  distanceBetween,
  type GlideFix,
  type GlidePoint,
  glideStep,
  isMoving,
  isRough,
  project,
  trailLevel,
} from './glide';

const GALATA = { lat: 41.0256, lng: 28.9742 };
const NOW = 1_800_000_000_000;

/** A car going east at 14 m/s, measured `age` ms ago, the location before it a second earlier. */
function car(age = 300, changes: Partial<GlideFix> = {}) {
  const fix: GlideFix = { ...GALATA, spd: 14, hdg: 90, acc: 5, ts: NOW - age, ...changes };
  const previous: GlideFix = {
    ...project(GALATA, 270, 14),
    spd: 14,
    hdg: 85,
    acc: 5,
    ts: fix.ts - 1_000,
  };
  return { fix, previous, shown: at(previous) };
}

/** Only the position of a point or a fix. */
function at(point: GlidePoint): GlidePoint {
  return { lat: point.lat, lng: point.lng };
}

describe('gliding between locations (docs/ADR/0028)', () => {
  it('projects along a heading by the given distance', () => {
    const east = project(GALATA, 90, 100);
    expect(distanceBetween(GALATA, east)).toBeCloseTo(100, 0);
    expect(east.lat).toBeCloseTo(GALATA.lat, 6);
    expect(east.lng).toBeGreaterThan(GALATA.lng);
    const north = project(GALATA, 0, 50);
    expect(north.lat).toBeGreaterThan(GALATA.lat);
  });

  it('places the first location', () => {
    const step = glideStep({
      shown: GALATA,
      fix: { ...GALATA, ts: NOW },
      previous: null,
      now: NOW,
    });
    expect(step).toEqual({ to: GALATA, durationMs: 0, linear: false });
  });

  it('glides over the gap between the two locations ×1.1, within limits', () => {
    const still = (gap: number) =>
      glideStep({
        shown: GALATA,
        fix: { ...project(GALATA, 0, 5), spd: 0, ts: NOW },
        previous: { ...GALATA, ts: NOW - gap },
        now: NOW,
      });
    expect(still(1_000)?.durationMs).toBe(1_100);
    expect(still(100)?.durationMs).toBe(glide.minSpanMs);
    expect(still(5_000)?.durationMs).toBe(glide.maxSpanMs);
    // Someone still eases into place, right onto the location.
    expect(still(1_000)).toMatchObject({ to: at(project(GALATA, 0, 5)), linear: false });
  });

  it('on a straight steady course, goes at most a second past the location', () => {
    const { fix, previous, shown } = car();
    const step = glideStep({ shown, fix, previous, now: NOW });
    expect(step?.linear).toBe(true);
    expect(step?.durationMs).toBe(1_100);
    expect(distanceBetween(GALATA, step?.to ?? GALATA)).toBeCloseTo(14 * (glide.leadMs / 1000), 0);
    expect(step?.to.lng).toBeGreaterThan(GALATA.lng);
  });

  it('never guesses more than a second ahead, however late the location or long the glide', () => {
    for (const age of [0, 500, 3_000, 20_000]) {
      for (const gap of [300, 1_000, 5_000, 25_000]) {
        for (const spd of [2, 14, 40, 80]) {
          const fix: GlideFix = { ...GALATA, spd, hdg: 90, acc: 5, ts: NOW - age };
          const previous: GlideFix = { ...GALATA, spd, hdg: 90, acc: 5, ts: fix.ts - gap };
          const step = glideStep({ shown: GALATA, fix, previous, now: NOW });
          // Never past the target: at most the speed × 1 s beyond the location, never behind it.
          expect(distanceBetween(GALATA, step?.to ?? GALATA)).toBeLessThanOrEqual(
            spd * (glide.leadMs / 1000) + 0.01,
          );
        }
      }
    }
  });

  it('guesses nothing on a bend: the pin goes to the location itself', () => {
    const { fix, previous, shown } = car(300, { hdg: 130 });
    const step = glideStep({ shown, fix, previous, now: NOW });
    expect(step).toEqual({ to: GALATA, durationMs: 1_100, linear: true });
  });

  it('guesses nothing when slowing to a stop, or when stopped', () => {
    const slow = car(300, { spd: 1.5 });
    expect(glideStep({ ...slow, now: NOW })?.to).toEqual(GALATA);
    const stopped = car(300, { spd: 0, hdg: null });
    expect(glideStep({ ...stopped, now: NOW })).toEqual({
      to: GALATA,
      durationMs: 1_100,
      linear: false,
    });
  });

  it('guesses nothing for a rough location, or without a heading before', () => {
    expect(glideStep({ ...car(300, { acc: 60 }), now: NOW })?.to).toEqual(GALATA);
    // Indoors: the best Wi-Fi guess, drawn as a circle (isRough), never guessed ahead.
    expect(glideStep({ ...car(300, { acc: 250 }), now: NOW })?.to).toEqual(GALATA);
    const { fix, previous, shown } = car();
    expect(glideStep({ shown, fix, previous: { ...previous, hdg: null }, now: NOW })?.to).toEqual(
      GALATA,
    );
  });

  it('stays put when a location measured before the shown one arrives late', () => {
    const { fix, previous, shown } = car();
    expect(glideStep({ shown, fix: { ...fix, ts: previous.ts - 1 }, previous, now: NOW })).toBe(
      null,
    );
    // The same time again (a coarser precision for that position) still moves it.
    expect(glideStep({ shown, fix: { ...fix, ts: previous.ts }, previous, now: NOW })).not.toBe(
      null,
    );
  });

  it('places, without gliding, after a long gap or across town', () => {
    const { fix, previous, shown } = car();
    const late = { ...previous, ts: fix.ts - glide.jumpGapMs - 1 };
    expect(glideStep({ shown, fix, previous: late, now: NOW })?.durationMs).toBe(0);
    const far = { ...fix, ...project(GALATA, 45, glide.teleportM + 100) };
    expect(glideStep({ shown, fix: far, previous, now: NOW })).toEqual({
      to: at(far),
      durationMs: 0,
      linear: false,
    });
  });

  it('draws a circle for a rough location, not for a neighbourhood or city cell', () => {
    expect(isRough(undefined)).toBe(false);
    expect(isRough(30)).toBe(false);
    expect(isRough(250)).toBe(true);
    expect(isRough(708)).toBe(false);
    expect(isRough(7_072)).toBe(false);
  });

  it('needs both a speed and a heading to count as moving', () => {
    expect(isMoving({ spd: 5, hdg: 10 })).toBe(true);
    expect(isMoving({ spd: 5, hdg: null })).toBe(false);
    expect(isMoving({ spd: 0.5, hdg: 10 })).toBe(false);
    expect(isMoving({})).toBe(false);
  });

  it('grows the trail with speed', () => {
    expect(trailLevel(null)).toBe(0);
    expect(trailLevel(0.4)).toBe(0);
    expect(trailLevel(1.4)).toBe(1);
    expect(trailLevel(5)).toBe(2);
    expect(trailLevel(25)).toBe(3);
  });
});

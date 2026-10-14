import { glide } from '@/theme/motion';

import { distanceBetween, glideStep, isMoving, nextInterval, project, trailLevel } from './glide';

const GALATA = { lat: 41.0256, lng: 28.9742 };
const NOW = 1_800_000_000_000;

describe('gliding between locations', () => {
  it('projects along a heading by the given distance', () => {
    const east = project(GALATA, 90, 100);
    expect(distanceBetween(GALATA, east)).toBeCloseTo(100, 0);
    expect(east.lat).toBeCloseTo(GALATA.lat, 6);
    expect(east.lng).toBeGreaterThan(GALATA.lng);
    const north = project(GALATA, 0, 50);
    expect(north.lat).toBeGreaterThan(GALATA.lat);
  });

  it('settles a still person into place', () => {
    const fix = { ...project(GALATA, 0, 20), spd: 0, hdg: null, ts: NOW };
    const step = glideStep({ shown: GALATA, fix, now: NOW, intervalMs: 5_000 });
    expect(step).toEqual({
      to: { lat: fix.lat, lng: fix.lng },
      durationMs: glide.settle,
      linear: false,
    });
  });

  it('carries a moving person on until the next location is due', () => {
    // 14 m/s east (a car), measured 300 ms ago, next one expected in 5 s.
    const fix = { ...GALATA, spd: 14, hdg: 90, ts: NOW - 300 };
    const step = glideStep({ shown: project(GALATA, 270, 30), fix, now: NOW, intervalMs: 5_000 });
    expect(step.linear).toBe(true);
    expect(step.durationMs).toBe(5_000);
    // Where the car should be 5.3 s after the fix: 74 m east of it.
    expect(distanceBetween(GALATA, step.to)).toBeCloseTo(14 * 5.3, 0);
    expect(step.to.lng).toBeGreaterThan(GALATA.lng);
  });

  it('never extrapolates more than the limit past a location', () => {
    const fix = { ...GALATA, spd: 10, hdg: 0, ts: NOW - 4_000 };
    const step = glideStep({ shown: GALATA, fix, now: NOW, intervalMs: 60_000 });
    expect(step.durationMs).toBe(glide.maxAheadMs - 4_000);
    expect(distanceBetween(GALATA, step.to)).toBeCloseTo(10 * (glide.maxAheadMs / 1000), 0);
    // Already older than the limit: it only settles on the location.
    const old = { ...fix, ts: NOW - glide.maxAheadMs - 1 };
    expect(glideStep({ shown: GALATA, fix: old, now: NOW, intervalMs: 5_000 }).linear).toBe(false);
  });

  it('jumps instead of gliding across the city', () => {
    const far = { ...project(GALATA, 45, glide.teleportM + 500), spd: 14, hdg: 45, ts: NOW };
    expect(glideStep({ shown: GALATA, fix: far, now: NOW, intervalMs: 5_000 }).durationMs).toBe(0);
  });

  it('needs both a speed and a heading to count as moving', () => {
    expect(isMoving({ spd: 5, hdg: 10 })).toBe(true);
    expect(isMoving({ spd: 5, hdg: null })).toBe(false);
    expect(isMoving({ spd: 0.5, hdg: 10 })).toBe(false);
    expect(isMoving({})).toBe(false);
  });

  it('expects the next location after the last gap, within limits', () => {
    expect(nextInterval(null, NOW)).toBe(glide.defaultIntervalMs);
    expect(nextInterval(NOW - 1_000, NOW)).toBe(1_000);
    expect(nextInterval(NOW - 100, NOW)).toBe(glide.minIntervalMs);
    expect(nextInterval(NOW - 600_000, NOW)).toBe(glide.maxAheadMs);
  });

  it('grows the trail with speed', () => {
    expect(trailLevel(null)).toBe(0);
    expect(trailLevel(0.4)).toBe(0);
    expect(trailLevel(1.4)).toBe(1);
    expect(trailLevel(5)).toBe(2);
    expect(trailLevel(25)).toBe(3);
  });
});

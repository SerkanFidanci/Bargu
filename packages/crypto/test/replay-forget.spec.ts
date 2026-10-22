import { describe, expect, it } from 'vitest';

import { ReplayGuard } from '../src/replay.js';
import { ids } from './helpers.js';

describe('ReplayGuard.forgetSenders', () => {
  it('forgets what was accepted from the named devices in every circle, and nothing else', () => {
    const guard = new ReplayGuard();
    guard.accept(ids.circle, ids.bobDevice, 1, 5);
    guard.accept(ids.otherCircle, ids.bobDevice, 1, 2);
    guard.accept(ids.circle, ids.carolDevice, 1, 9);

    expect(guard.forgetSenders(new Set([ids.bobDevice]))).toBe(2);

    // Bob's window is empty again, so the same message counts as new; Carol's is untouched.
    expect(guard.check(ids.circle, ids.bobDevice, 1, 5)).toBe('latest');
    expect(guard.check(ids.otherCircle, ids.bobDevice, 1, 2)).toBe('latest');
    expect(guard.check(ids.circle, ids.carolDevice, 1, 9)).toBe('replay');
    expect(Object.keys(guard.toJSON())).toEqual([`${ids.circle}/${ids.carolDevice}`]);
  });

  it('does nothing for a device it never heard from', () => {
    const guard = new ReplayGuard();
    guard.accept(ids.circle, ids.carolDevice, 1, 9);
    expect(guard.forgetSenders(new Set([ids.bobDevice]))).toBe(0);
    expect(guard.forgetSenders(new Set())).toBe(0);
    expect(guard.check(ids.circle, ids.carolDevice, 1, 9)).toBe('replay');
  });
});

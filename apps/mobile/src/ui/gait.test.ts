import { activityFx } from '@/theme/motion';

import { gaitPose, leanSideOf } from './gait';

const walk = activityFx.walk;

describe('gait', () => {
  it('lands each step with a squash and rises in a soft arc, twice per cycle', () => {
    const landing = gaitPose(0, walk, 0);
    expect(landing.lift).toBeCloseTo(0, 5);
    expect(landing.scaleY).toBeCloseTo(1 - walk.squash, 5);
    expect(landing.scaleX).toBeGreaterThan(1);
    const midStep = gaitPose(0.25, walk, 0);
    expect(midStep.lift).toBeCloseTo(1, 5);
    expect(midStep.y).toBeCloseTo(-walk.lift, 5);
    expect(midStep.scaleY).toBeCloseTo(1, 5);
    // The second step of the cycle rises just like the first.
    expect(gaitPose(0.75, walk, 0).lift).toBeCloseTo(1, 5);
  });

  it('shifts the weight to one side and back once per cycle', () => {
    expect(gaitPose(0.25, walk, 0).x).toBeCloseTo(walk.sway, 5);
    expect(gaitPose(0.75, walk, 0).x).toBeCloseTo(-walk.sway, 5);
    expect(gaitPose(0.25, walk, 0).rotate).toBeCloseTo(walk.tilt, 5);
  });

  it('leans towards where they are going on a north-up map', () => {
    expect(leanSideOf(90)).toBeCloseTo(1, 5);
    expect(leanSideOf(270)).toBeCloseTo(-1, 5);
    expect(leanSideOf(0)).toBeCloseTo(0, 5);
    expect(leanSideOf(null)).toBe(0);
    expect(gaitPose(0, walk, 1).rotate).toBeCloseTo(walk.lean, 5);
  });
});

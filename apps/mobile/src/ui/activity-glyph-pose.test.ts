import { BIKE, FIGURE, footOf, pedalPose, stridePose } from './activity-glyph-pose';

const steps = (count: number) => Array.from({ length: count }, (_, index) => index / count);

describe('the walker and the runner (the owner, 2026-10-21)', () => {
  it('swing the legs in turn and each arm against its leg', () => {
    const pose = stridePose(0, false);
    // Near leg forward, far leg back; the near arm back.
    expect(pose.near.thigh).toBeGreaterThan(0);
    expect(pose.far.thigh).toBeLessThan(0);
    expect(pose.nearArm.arm).toBeLessThan(0);
    const half = stridePose(0.5, false);
    expect(half.near.thigh).toBeCloseTo(pose.far.thigh, 5);
  });

  it('keep the lower foot on the ground when walking, all the way through the stride', () => {
    for (const phase of steps(24)) {
      const pose = stridePose(phase, false);
      const lowest = Math.max(footOf(pose.near, FIGURE.walk).y, footOf(pose.far, FIGURE.walk).y);
      expect(FIGURE.hip.y + pose.dy + lowest).toBeCloseTo(FIGURE.ground, 5);
    }
  });

  it('let the runner fold the knee higher and leave the ground for a moment', () => {
    const walkFold = Math.max(...steps(24).map((p) => stridePose(p, false).near.knee));
    const runFold = Math.max(...steps(24).map((p) => stridePose(p, true).near.knee));
    expect(runFold).toBeGreaterThan(walkFold + 40);
    const airborne = steps(48).some((p) => {
      const pose = stridePose(p, true);
      const lowest = Math.max(footOf(pose.near, FIGURE.run).y, footOf(pose.far, FIGURE.run).y);
      return FIGURE.hip.y + pose.dy + lowest < FIGURE.ground - 1;
    });
    expect(airborne).toBe(true);
    // Elbows bent when running.
    expect(stridePose(0.3, true).nearArm.fore).toBeGreaterThan(60);
  });
});

describe('the cyclist', () => {
  it('keeps the foot on the pedal all the way round, the knee in front', () => {
    for (const phase of steps(16)) {
      for (const side of [0, 1] as const) {
        const pose = pedalPose(phase, side);
        const foot = footOf(pose, { thigh: BIKE.thigh, shin: BIKE.shin });
        const angle = 2 * Math.PI * phase + side * Math.PI;
        const pedal = {
          x: BIKE.crank.x + BIKE.crank.radius * Math.cos(angle) - BIKE.hip.x,
          y: BIKE.crank.y + BIKE.crank.radius * Math.sin(angle) - 1 - BIKE.hip.y,
        };
        expect(foot.x).toBeCloseTo(pedal.x, 1);
        expect(foot.y).toBeCloseTo(pedal.y, 1);
        // The knee is ahead of (to the right of) the line from hip to foot.
        const rad = (pose.thigh * Math.PI) / 180;
        const knee = { x: BIKE.thigh * Math.sin(rad), y: BIKE.thigh * Math.cos(rad) };
        expect(foot.x * knee.y - foot.y * knee.x).toBeLessThan(0);
      }
    }
  });
});

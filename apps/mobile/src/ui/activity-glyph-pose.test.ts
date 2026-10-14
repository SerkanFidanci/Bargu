import { limbAngles, PEDAL_SEGMENT, pedalLeg } from './activity-glyph-pose';

/** Where a two-segment leg hanging from the hip ends, given its drawn rotations (degrees). */
function footOf(thigh: number, shin: number, segment = PEDAL_SEGMENT) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  // A positive rotation swings a hanging limb towards -x.
  const knee = { x: -segment * Math.sin(rad(thigh)), y: segment * Math.cos(rad(thigh)) };
  const total = thigh + shin;
  return { x: knee.x - segment * Math.sin(rad(total)), y: knee.y + segment * Math.cos(rad(total)) };
}

describe('activity drawings', () => {
  it('swing the legs in turn and the arms against them', () => {
    const left = limbAngles(0.25, false, 0);
    const right = limbAngles(0.25, false, 1);
    expect(left.thigh).toBeCloseTo(-right.thigh, 5);
    // Arm and leg on the same side swing opposite ways.
    expect(Math.sign(left.arm)).toBe(-Math.sign(left.thigh));
  });

  it('fold the trailing knee and bend the elbows when running', () => {
    const trailing = limbAngles(0.75, true, 0);
    const leading = limbAngles(0.25, true, 0);
    expect(trailing.shin).toBeGreaterThan(leading.shin + 40);
    expect(trailing.forearm).toBeLessThan(-60);
  });

  it('keep the cyclist’s foot on the pedal all the way round', () => {
    for (let step = 0; step < 16; step++) {
      const phase = step / 16;
      const { thigh, shin } = pedalLeg(phase, 0);
      const foot = footOf(thigh, shin);
      const angle = 2 * Math.PI * phase;
      const pedal = { x: 14 + 3 * Math.cos(angle) - 11, y: 21 + 3 * Math.sin(angle) - 13 };
      expect(foot.x).toBeCloseTo(pedal.x, 1);
      expect(foot.y).toBeCloseTo(pedal.y, 1);
    }
  });
});

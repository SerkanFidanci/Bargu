import { COSMETIC_PACKS } from '@bargu/schemas';

import {
  around,
  dotDashes,
  evenDashes,
  isFrameStyle,
  isRingPattern,
  starPath,
} from './look-styles';

describe('the styles of the packs', () => {
  it('knows the four ring patterns and the four frames, and no style of the other pack', () => {
    for (const id of COSMETIC_PACKS.rings) {
      expect(isRingPattern(id)).toBe(true);
      expect(isFrameStyle(id)).toBe(false);
    }
    for (const id of COSMETIC_PACKS.frames) {
      expect(isFrameStyle(id)).toBe(true);
      expect(isRingPattern(id)).toBe(false);
    }
    expect(isRingPattern(null)).toBe(false);
    expect(isFrameStyle('rainbow')).toBe(false);
  });
});

describe('the drawing of the ring', () => {
  it('splits a ring into equal dashes and gaps all the way round', () => {
    const { dash, gap } = evenDashes(20, 24);
    expect(dash).toBeCloseTo(gap);
    expect((dash + gap) * 24).toBeCloseTo(2 * Math.PI * 20);
  });

  it('makes dots of a dash too short to show: the round cap is the dot', () => {
    const { dash, gap } = dotDashes(20, 12);
    expect(dash).toBeLessThan(0.1);
    expect(gap * 12).toBeCloseTo(2 * Math.PI * 20, 0);
  });

  it('puts things round a circle from the top, as far from the centre as the radius', () => {
    const spots = around(30, 20, 8);
    expect(spots).toHaveLength(8);
    expect(spots[0]?.x).toBeCloseTo(30);
    expect(spots[0]?.y).toBeCloseTo(10);
    for (const spot of spots) {
      expect(Math.hypot(spot.x - 30, spot.y - 30)).toBeCloseTo(20);
    }
  });

  it('draws a four-pointed star: eight corners, closed', () => {
    const path = starPath(10, 10, 7);
    expect(path.startsWith('M10.00 3.00')).toBe(true);
    expect(path.match(/L/g)).toHaveLength(7);
    expect(path.endsWith('Z')).toBe(true);
  });
});

import { stickerFx } from '@/theme';

import { stickerTilt } from './sticker';

describe('a sticker on the map', () => {
  it('leans the same way every time for the same person, never upright', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `person-${String(index)}`);
    for (const id of ids) {
      const tilt = stickerTilt(id);
      expect(stickerTilt(id)).toBe(tilt);
      expect(Math.abs(tilt)).toBeGreaterThanOrEqual(stickerFx.tilt.min);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(stickerFx.tilt.max);
    }
    // Both ways, so people side by side do not all lean alike.
    const left = ids.filter((id) => stickerTilt(id) < 0).length;
    expect(left).toBeGreaterThan(60);
    expect(left).toBeLessThan(140);
  });
});

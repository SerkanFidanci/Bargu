import { dockShape } from '@/theme';

import { DOCK_RISE, dockOutline } from './dock-shape';

/** The hump the + sits in (the owner's picture, 2026-10-28): it must turn smoothly everywhere. */
describe('the dock outline', () => {
  const width = 360;
  const height = 64;
  const outline = dockOutline(width, height);
  const r = dockShape.add / 2 + dockShape.ring;
  const f = dockShape.fillet;
  // The hump's centre is the +'s: `drop` under the bar's top edge, in the middle.
  const hump = { x: 0, y: outline.rise + dockShape.drop };

  it('rises as the + needs, its top on the top of the drawing (nothing cut off)', () => {
    expect(outline.rise).toBe(DOCK_RISE);
    expect(hump.y - r).toBe(0);
  });

  it('meets its fillets on both circles, where they touch, so there is no corner', () => {
    const start = /L (\S+) (\S+)/.exec(outline.path);
    expect(start).not.toBeNull();
    const xf = width / 2 - Number(start?.[1]);
    expect(Number(start?.[2])).toBe(outline.rise);
    const fillet = { x: xf, y: outline.rise - f };
    // The fillet touches the top edge and the hump: its centre is f above one and r + f from the other.
    expect(Math.hypot(fillet.x - hump.x, fillet.y - hump.y)).toBeCloseTo(r + f, 6);
    expect(Math.hypot(outline.join.x - hump.x, outline.join.y - hump.y)).toBeCloseTo(r, 6);
    expect(Math.hypot(outline.join.x - fillet.x, outline.join.y - fillet.y)).toBeCloseTo(f, 6);
  });

  it('is one closed outline of real numbers, the bar under the hump as tall as given', () => {
    expect(outline.path.startsWith('M ')).toBe(true);
    expect(outline.path.endsWith('Z')).toBe(true);
    expect(outline.path).not.toMatch(/NaN|Infinity/);
    expect(outline.path).toContain(` ${String(outline.rise + height)} L `);
  });
});

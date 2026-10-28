import { dockShape, radius } from '@/theme';

/** How far the hump stands above the bar's top edge (the + inside it, `ring` around it). */
export const DOCK_RISE = dockShape.add / 2 + dockShape.ring - dockShape.drop;

/** The dock's outline as drawn (SVG): its top edge is at `rise`, the hump stands above it. */
export interface DockOutline {
  path: string;
  /** How far the hump rises above the bar's top edge. */
  rise: number;
  /** Where the hump meets its fillets, from the middle (to check the joins are smooth). */
  join: { x: number; y: number };
}

/**
 * The bar with the hump the + sits in (the owner's picture, 2026-10-28): a rounded bar, and in its
 * middle a circle around the + (its gap `ring` all round) joined to the top edge by two small
 * fillets, so the outline turns smoothly everywhere. All from dockShape and the bar's size.
 */
export function dockOutline(width: number, height: number): DockOutline {
  const r = dockShape.add / 2 + dockShape.ring;
  const drop = dockShape.drop;
  const f = dockShape.fillet;
  const rise = DOCK_RISE;
  const top = rise;
  const cx = width / 2;
  // A fillet's centre is f above the top edge and r + f from the hump's centre.
  const xf = Math.sqrt((r + f) ** 2 - (drop + f) ** 2);
  // Where a fillet meets the hump: on the line between their centres, f from the fillet's.
  const k = f / (r + f);
  const join = { x: xf * (1 - k), y: top - f + (drop + f) * k };
  const c = Math.min(radius.xl, height / 2);
  const bottom = top + height;
  const path = [
    cmd('M', c, top),
    cmd('L', cx - xf, top),
    cmd('A', f, f, 0, 0, 0, cx - join.x, join.y),
    cmd('A', r, r, 0, 0, 1, cx + join.x, join.y),
    cmd('A', f, f, 0, 0, 0, cx + xf, top),
    cmd('L', width - c, top),
    cmd('A', c, c, 0, 0, 1, width, top + c),
    cmd('L', width, bottom - c),
    cmd('A', c, c, 0, 0, 1, width - c, bottom),
    cmd('L', c, bottom),
    cmd('A', c, c, 0, 0, 1, 0, bottom - c),
    cmd('L', 0, top + c),
    cmd('A', c, c, 0, 0, 1, c, top),
    'Z',
  ].join(' ');
  return { path, rise, join };
}

/** One SVG path command: its letter and its numbers. */
function cmd(letter: string, ...numbers: number[]): string {
  return [letter, ...numbers.map(String)].join(' ');
}

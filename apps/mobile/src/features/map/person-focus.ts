import { makeMutable } from 'react-native-reanimated';
import { create } from 'zustand';

import { space, touchTarget } from '@/theme';

/** What can be done with a person from the map (BARGU_PLAN §4.3 radial menu). */
export const PERSON_ACTIONS = ['poke', 'directions', 'profile', 'notifications'] as const;
export type PersonAction = (typeof PERSON_ACTIONS)[number];

/** A point on the screen (window coordinates). */
export interface ScreenPoint {
  x: number;
  y: number;
}

interface FocusState {
  /** The person whose card is open, and where on screen their avatar was tapped. */
  selected: { userId: string; from: ScreenPoint } | null;
  /** The radial menu around a held avatar. */
  menu: { userId: string; origin: ScreenPoint; below: boolean } | null;
}

export const usePersonFocus = create<FocusState>(() => ({ selected: null, menu: null }));

/** Distance from the avatar to the menu items' centres. */
export const RADIAL_RADIUS = space.xxxl * 2;
/** Items fan out above the avatar; near the top of the screen, below it instead. */
const ANGLES_ABOVE = [-150, -110, -70, -30] as const;
/** An item is chosen when the finger is this close to its direction (degrees)… */
const HIT_ANGLE = 22;
/** …and at least this far from the avatar (px). */
const HIT_MIN_DISTANCE = RADIAL_RADIUS / 2;

/** The menu opens below the avatar when there is no room above it. */
export function opensBelow(origin: ScreenPoint, topInset: number): boolean {
  'worklet';
  return origin.y - RADIAL_RADIUS - touchTarget < topInset;
}

export function radialAngles(below: boolean): readonly number[] {
  return below ? ANGLES_ABOVE.map((angle) => -angle) : ANGLES_ABOVE;
}

/** Where item `index` sits around `origin`. */
export function radialPosition(origin: ScreenPoint, below: boolean, index: number): ScreenPoint {
  const angle = ((radialAngles(below)[index] ?? 0) * Math.PI) / 180;
  return {
    x: origin.x + Math.cos(angle) * RADIAL_RADIUS,
    y: origin.y + Math.sin(angle) * RADIAL_RADIUS,
  };
}

/** The item a finger at `finger` points to, or -1 (runs on the UI thread while dragging). */
export function hoveredItem(origin: ScreenPoint, below: boolean, finger: ScreenPoint): number {
  'worklet';
  const dx = finger.x - origin.x;
  const dy = finger.y - origin.y;
  if (Math.hypot(dx, dy) < HIT_MIN_DISTANCE) return -1;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  let best = -1;
  let bestGap = HIT_ANGLE;
  for (let index = 0; index < ANGLES_ABOVE.length; index++) {
    const itemAngle = below ? -(ANGLES_ABOVE[index] ?? 0) : (ANGLES_ABOVE[index] ?? 0);
    const gap = Math.abs(angle - itemAngle);
    if (gap <= bestGap) {
      best = index;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The open menu as the UI thread sees it: the held avatar's gesture updates `menuHover` while the
 * finger moves, without a trip to JavaScript; the menu reads it to highlight an item.
 */
export const menuOrigin = makeMutable<ScreenPoint>({ x: 0, y: 0 });
export const menuBelow = makeMutable(false);
export const menuHover = makeMutable(-1);

export function openCard(userId: string, from: ScreenPoint): void {
  usePersonFocus.setState({ selected: { userId, from }, menu: null });
}

export function closeCard(): void {
  usePersonFocus.setState({ selected: null });
}

export function openMenu(userId: string, origin: ScreenPoint, topInset: number): void {
  const below = opensBelow(origin, topInset);
  menuOrigin.set(origin);
  menuBelow.set(below);
  menuHover.set(-1);
  usePersonFocus.setState({ menu: { userId, origin, below }, selected: null });
}

export function closeMenu(): void {
  menuHover.set(-1);
  usePersonFocus.setState({ menu: null });
}

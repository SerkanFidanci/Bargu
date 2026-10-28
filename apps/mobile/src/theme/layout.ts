/** Spacing on a 4-point grid (BARGU_PLAN §4.4). */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Minimum touch target (Apple HIG 44 pt, Material 48 dp): the larger one, everywhere. */
export const touchTarget = 48;

/** Shadows as CSS box-shadow strings (New Architecture), one per elevation level. */
export const elevation = {
  raised: '0px 2px 8px rgba(0, 0, 0, 0.12)',
  floating: '0px 8px 24px rgba(0, 0, 0, 0.18)',
} as const;

/** Avatar diameters. */
export const avatarSize = {
  sm: 28,
  md: 40,
  lg: 64,
  xl: 96,
} as const;

/**
 * The dock's shape (the owner's picture, 2026-10-28): five equal columns, the + raised on a smooth
 * hump above the middle one. `add` is the button's size, `ring` the gap the hump leaves around it,
 * `drop` how far below the bar's top edge its centre sits, `fillet` the radius that joins the hump
 * to the bar.
 */
export const dockShape = {
  add: touchTarget + space.md,
  ring: 6,
  drop: 10,
  fillet: 10,
} as const;

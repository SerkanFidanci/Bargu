import { AVATAR_COLORS } from '@bargu/schemas';

/**
 * Colour tokens (docs/DESIGN.md). Every text/background pair used by components is checked for
 * WCAG AA contrast in colors.test.ts; change a value and the test tells you if it still reads.
 */
export interface ColorTokens {
  /** Screen background behind sheets; the map replaces it on the main screen. */
  background: string;
  /** Sheets, cards, inputs. */
  surface: string;
  /** Elements raised above a surface (dock, pills, toasts). */
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  /** Brand violet: primary actions and focus. */
  primary: string;
  onPrimary: string;
  /** Tinted background for selected / primary-adjacent elements. */
  primarySoft: string;
  /** Coral: playful highlights (poke, meet-up), never for text on light backgrounds. */
  accent: string;
  onAccent: string;
  success: string;
  onSuccess: string;
  danger: string;
  onDanger: string;
  /** Ghost mode tint (desaturated, quiet). */
  ghost: string;
  /** Dims the map behind a modal sheet. */
  scrim: string;
  /**
   * A still glow around what is chosen or primary (a selected option, the add button): never
   * text, never animated; none at sade mod "off" (docs/ADR/0008, theme 2026-10-18).
   */
  glow: string;
  /**
   * The store's own advert on the map (docs/ADR/0025 Ek 2): a band from `primary` to this
   * magenta, `onPromo` on both ends, and a light that crosses it a few times.
   */
  promo: string;
  onPromo: string;
  promoShine: string;
}

export const lightColors: ColorTokens = {
  background: '#FFFFFF',
  surface: '#F5F3FF',
  surfaceRaised: '#FFFFFF',
  text: '#16142B',
  textMuted: '#5C5876',
  border: '#E2DDF5',
  primary: '#5B34F2',
  onPrimary: '#FFFFFF',
  primarySoft: '#EEE9FF',
  accent: '#FF6A3D',
  onAccent: '#16151C',
  success: '#047857',
  onSuccess: '#FFFFFF',
  danger: '#CC2A1E',
  onDanger: '#FFFFFF',
  ghost: '#8A8896',
  scrim: 'rgba(10, 10, 15, 0.4)',
  glow: 'rgba(91, 52, 242, 0.32)',
  promo: '#C92E68',
  onPromo: '#FFFFFF',
  promoShine: 'rgba(255, 255, 255, 0.35)',
};

/**
 * Night: deep navy-violet surfaces with violet-tinted hairlines, white on the violet (the project
 * owner's theme, 2026-10-18).
 */
export const darkColors: ColorTokens = {
  background: '#0F0E22',
  surface: '#17152D',
  surfaceRaised: '#1F1C3A',
  text: '#F4F2FF',
  textMuted: '#ABA7C8',
  border: '#36305E',
  primary: '#7A55F6',
  onPrimary: '#FFFFFF',
  primarySoft: '#28214F',
  accent: '#FF7A52',
  onAccent: '#0F0E22',
  success: '#34D399',
  onSuccess: '#0F0E22',
  danger: '#F97066',
  onDanger: '#0F0E22',
  ghost: '#6E6A8A',
  scrim: 'rgba(5, 4, 20, 0.6)',
  glow: 'rgba(122, 85, 246, 0.55)',
  promo: '#C92E68',
  onPromo: '#FFFFFF',
  promoShine: 'rgba(255, 255, 255, 0.3)',
};

/**
 * The activity drawings' own colours (ui/activity-glyph.tsx, the owner's approved preview of
 * 2026-10-21): what changes with the theme, then what a car or a plane is made of in any light.
 */
export interface DrawingColors {
  /** Road dashes, smoke, air and speed lines. */
  mark: string;
  glass: string;
  tire: string;
  rim: string;
  sky: string;
  cloud: string;
}
export const drawingColors: Record<'light' | 'dark', DrawingColors> = {
  light: {
    mark: '#B7B4CA',
    glass: '#2B3550',
    tire: '#1B1A26',
    rim: '#C9CCD6',
    sky: '#E3EEFF',
    cloud: '#FFFFFF',
  },
  dark: {
    mark: '#4A456F',
    glass: '#0E1428',
    tire: '#0C0B16',
    rim: '#A9ACC0',
    sky: '#1B2552',
    cloud: '#3A4170',
  },
};
export const drawingParts = {
  headlight: '#FFF3C4',
  brakeLight: '#E5484D',
  visor: '#FFB020',
  shine: '#FFFFFF',
  shadow: '#000000',
  hull: '#F4F5FA',
  wing: '#B6BAC8',
  engine: '#8E93A6',
  tailplane: '#C9CCD6',
} as const;

/**
 * Avatar palette, indexed by the profile's `avatar.color` (packages/schemas AVATAR_COLORS). White
 * initials stay readable on each one, on the map in both themes.
 */
export const avatarPalette: readonly string[] = [
  '#E5484D',
  '#C2410C',
  '#B45309',
  '#4D7C0F',
  '#15803D',
  '#0F766E',
  '#0E7490',
  '#1D4ED8',
  '#4338CA',
  '#7C3AED',
  '#A21CAF',
  '#BE185D',
];

export const avatarText = '#FFFFFF';

if (avatarPalette.length !== AVATAR_COLORS) {
  throw new Error('avatar palette must match AVATAR_COLORS');
}

/** QR codes are always dark on white, in both themes: scanners expect that contrast. */
export const qrColors = { dark: '#16151C', light: '#FFFFFF' } as const;

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
  /** Brand navy, the logo's (docs/ADR/0008 Ek 2026-10-29): primary actions and focus. */
  primary: string;
  onPrimary: string;
  /** Tinted background for selected / primary-adjacent elements. */
  primarySoft: string;
  /** The logo's orange: playful highlights (poke, meet-up), never for text on light backgrounds. */
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
   * The brand's sweep (the owner, 2026-10-29: "Lacivert turuncu renk geçişleri"; docs/ADR/0008
   * Ek 2026-10-29): navy, through the logo's red, to a deep orange, evenly spaced. On the +
   * button, the story ring, one's own messages, the store's band and the main buttons; never under
   * much text. `onBrand` reads at every point of it (colors.test.ts).
   */
  brandGradient: readonly [string, string, string];
  onBrand: string;
  /** The light that crosses the store's band a few times (docs/ADR/0025 Ek 2). */
  brandShine: string;
  /** Messages (the owner, 2026-10-28: "like Instagram's DMs"): others' items on this grey. */
  bubble: string;
}

/** The tokens that are one colour (not the sweep): for text, icons and fills. */
export type ColorName = {
  [K in keyof ColorTokens]: ColorTokens[K] extends string ? K : never;
}[keyof ColorTokens];

/**
 * The logo's colours (apps/mobile/assets/brand/bargu-logo.png, sampled 2026-10-29): navy #0F2346
 * to #184B93, red #DD2025, orange #E87631 to #FC621E. The sweep's orange is deeper than the logo's
 * so white reads on it (4.5:1); the bright one is `accent`, with dark text.
 */
const sweepRed = '#D2303A';
const sweepOrange = '#C84B0E';

export const lightColors: ColorTokens = {
  background: '#FFFFFF',
  surface: '#F3F6FB',
  surfaceRaised: '#FFFFFF',
  text: '#0E1A33',
  textMuted: '#55607A',
  border: '#DCE3EF',
  primary: '#1E3F8A',
  onPrimary: '#FFFFFF',
  primarySoft: '#E6ECF8',
  accent: '#F26A21',
  onAccent: '#0E1A33',
  success: '#047857',
  onSuccess: '#FFFFFF',
  danger: '#CC2A1E',
  onDanger: '#FFFFFF',
  ghost: '#878FA3',
  scrim: 'rgba(6, 14, 32, 0.4)',
  glow: 'rgba(30, 63, 138, 0.32)',
  brandGradient: ['#1E3F8A', sweepRed, sweepOrange],
  onBrand: '#FFFFFF',
  brandShine: 'rgba(255, 255, 255, 0.35)',
  bubble: '#EEF1F7',
};

/**
 * Night: navy surfaces, the logo's (the owner, 2026-10-29), with a light blue for what is primary
 * so it reads on them as small text too (the dock's labels, T8); dark navy on it.
 */
export const darkColors: ColorTokens = {
  background: '#0A1630',
  surface: '#0F1F3E',
  surfaceRaised: '#172A4F',
  text: '#F1F5FF',
  textMuted: '#A7B3D0',
  border: '#2A3F6B',
  primary: '#6E95F2',
  onPrimary: '#0A1630',
  primarySoft: '#16274B',
  accent: '#FF7A3D',
  onAccent: '#0A1630',
  success: '#34D399',
  onSuccess: '#0A1630',
  danger: '#F97066',
  onDanger: '#0A1630',
  ghost: '#6B7592',
  scrim: 'rgba(3, 8, 20, 0.6)',
  glow: 'rgba(110, 149, 242, 0.5)',
  brandGradient: ['#2A55B8', sweepRed, sweepOrange],
  onBrand: '#FFFFFF',
  brandShine: 'rgba(255, 255, 255, 0.3)',
  bubble: '#1F3360',
};

/**
 * A colour `t` of the way along evenly spaced stops (the brand's sweep), as #RRGGBB: what a
 * gradient drawn with those stops shows there.
 */
export function gradientAt(stops: readonly string[], t: number): string {
  const first = stops[0];
  if (first === undefined) throw new Error('a gradient needs a colour');
  const at = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const index = Math.min(Math.floor(at), stops.length - 2);
  if (index < 0) return first;
  return mixColor(stops[index] ?? first, stops[index + 1] ?? first, at - index);
}

/** A colour `t` of the way from `from` to `to` (both #RRGGBB), as #RRGGBB. */
export function mixColor(from: string, to: string, t: number): string {
  const at = Math.min(1, Math.max(0, t));
  const channel = (hex: string, index: number) =>
    parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2]
    .map((index) =>
      Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * at)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

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

/**
 * Photos (docs/ADR/0035): the camera and the viewer are dark in both themes, so a picture is seen as
 * it is; text and controls on it are white over a shade. The story ring is the theme's
 * `brandGradient`.
 */
export const mediaColors = {
  backdrop: '#000000',
  onBackdrop: '#FFFFFF',
  shade: 'rgba(0, 0, 0, 0.45)',
  track: 'rgba(255, 255, 255, 0.35)',
} as const;

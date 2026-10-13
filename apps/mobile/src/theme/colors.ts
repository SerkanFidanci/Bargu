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
}

export const lightColors: ColorTokens = {
  background: '#FFFFFF',
  surface: '#F5F4F1',
  surfaceRaised: '#FFFFFF',
  text: '#16151C',
  textMuted: '#5E5C68',
  border: '#E4E2DC',
  primary: '#5B34F2',
  onPrimary: '#FFFFFF',
  primarySoft: '#EEE9FF',
  accent: '#FF6A3D',
  onAccent: '#16151C',
  success: '#047857',
  onSuccess: '#FFFFFF',
  danger: '#D92D20',
  onDanger: '#FFFFFF',
  ghost: '#8A8896',
  scrim: 'rgba(10, 10, 15, 0.4)',
};

export const darkColors: ColorTokens = {
  background: '#0D0D12',
  surface: '#17171E',
  surfaceRaised: '#202029',
  text: '#F3F2EE',
  textMuted: '#A6A4B0',
  border: '#2C2C36',
  primary: '#8C6CFF',
  onPrimary: '#0D0D12',
  primarySoft: '#2A2147',
  accent: '#FF7A52',
  onAccent: '#0D0D12',
  success: '#34D399',
  onSuccess: '#0D0D12',
  danger: '#F97066',
  onDanger: '#0D0D12',
  ghost: '#6E6C7A',
  scrim: 'rgba(0, 0, 0, 0.55)',
};

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

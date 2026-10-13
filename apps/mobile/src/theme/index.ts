import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from 'expo-router';
import { useColorScheme } from 'react-native';

import { type ColorTokens, darkColors, lightColors } from './colors';

export { avatarPalette, avatarText, type ColorTokens } from './colors';
export { avatarSize, elevation, radius, space, touchTarget } from './layout';
export { ambient, duration, haptic, press, spring, timing, typingDebounceMs } from './motion';
export { font, typography, type TypographyVariant } from './typography';

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
}

const themes: Record<ColorScheme, Theme> = {
  light: { scheme: 'light', colors: lightColors },
  dark: { scheme: 'dark', colors: darkColors },
};

/** The active theme, following the system appearance (light/dark). */
export function useTheme(): Theme {
  return themes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

/** Navigation chrome (headers, screen backgrounds) in the same colours. */
export function navigationTheme({ scheme, colors }: Theme): NavigationTheme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surfaceRaised,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
  };
}

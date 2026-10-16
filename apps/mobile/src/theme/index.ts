import { useColorScheme } from 'react-native';

import { type ColorTokens, darkColors, lightColors } from './colors';

export { avatarPalette, avatarText, type ColorTokens, qrColors, stickerPaper } from './colors';
export { avatarSize, elevation, radius, space, touchTarget } from './layout';
export {
  activityFx,
  ambient,
  choreography,
  duration,
  glide,
  haptic,
  meetFx,
  orbit,
  press,
  spring,
  stickerFx,
  timing,
  typingDebounceMs,
  weatherFx,
} from './motion';
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

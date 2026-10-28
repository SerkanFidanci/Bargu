import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { type ColorName, typography, type TypographyVariant, useTheme } from '@/theme';

export interface TextProps extends NativeTextProps {
  variant?: TypographyVariant;
  color?: ColorName;
  align?: 'auto' | 'left' | 'center' | 'right';
}

/**
 * All text in the app. Follows the system text size up to the variant's cap, so large accessibility
 * sizes stay usable without breaking layouts on small phones.
 */
export function Text({ variant = 'body', color = 'text', align, style, ...props }: TextProps) {
  const { colors } = useTheme();
  const type = typography[variant];
  return (
    <NativeText
      maxFontSizeMultiplier={type.maxScale}
      {...props}
      style={[
        type.style,
        { color: colors[color] },
        align === undefined ? null : { textAlign: align },
        style,
      ]}
    />
  );
}

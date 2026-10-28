import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

/**
 * The stops of the brand's sweep (docs/ADR/0008 Ek 2026-10-29), evenly spaced, for a `LinearGradient`: its
 * children must be stops themselves, so this gives elements, not a component.
 */
export function brandStops(stops: readonly string[]) {
  return stops.map((color, index) => (
    <Stop key={color} offset={index / Math.max(1, stops.length - 1)} stopColor={color} />
  ));
}

/** An id for an SVG gradient, unique on the screen and usable in `url(#…)`. */
export function useGradientId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^\w-]/g, '')}`;
}

/**
 * The brand's sweep filling its parent from the upper left to the lower right (the + button, the
 * main buttons, the store's band): the parent clips it to its own shape.
 */
export function BrandFill() {
  const { colors } = useTheme();
  const id = useGradientId('brand');
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {brandStops(colors.brandGradient)}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

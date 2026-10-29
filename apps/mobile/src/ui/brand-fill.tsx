import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

/**
 * The stops of the brand's sweep (docs/ADR/0008 Ek 2026-10-29), evenly spaced, for a
 * `LinearGradient`: its children must be stops themselves, so this gives elements, not a component.
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
 * The brand's sweep filling its parent from the upper left to the lower right (the main buttons,
 * the primary action tile): the parent clips it to its own shape. Drawn at the size it measures, in
 * numbers: a percentage size on the SVG drew only part of a button on Android (the owner, 2026-10-29:
 * "butonlardaki renk geçişleri hatalı"), as the store's band was before it measured itself.
 */
export function BrandFill() {
  const { colors } = useTheme();
  const id = useGradientId('brand');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      testID="brand-fill"
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) =>
          current?.width === width && current.height === height ? current : { width, height },
        );
      }}
    >
      {size === null ? null : (
        <Svg width={size.width} height={size.height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              {brandStops(colors.brandGradient)}
            </LinearGradient>
          </Defs>
          <Rect width={size.width} height={size.height} fill={`url(#${id})`} />
        </Svg>
      )}
    </View>
  );
}

import { Camera, Map, type ViewPadding } from '@maplibre/maplibre-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { space, useTheme } from '@/theme';

import { INITIAL_VIEW, mapStyle } from './style';

export interface BarguMapProps {
  /** Space taken by overlays (pill, dock), so ornaments and the camera avoid them. */
  insets: ViewPadding;
  children?: ReactNode;
}

/**
 * The map behind everything. Tiles, fonts and icons come from our own server (no third party learns
 * the viewport, i.e. where the user looks); the style follows light/dark mode.
 */
export function BarguMap({ insets, children }: BarguMapProps) {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  return (
    <Map
      testID="map"
      accessibilityLabel={t('main.map')}
      style={StyleSheet.absoluteFill}
      mapStyle={mapStyle(scheme)}
      contentInset={insets}
      logo={false}
      compass={false}
      scaleBar={false}
      touchPitch={false}
      // OpenStreetMap licence: the credit stays visible (bottom left, above the dock).
      attribution
      attributionPosition={{ bottom: insets.bottom ?? 0, left: space.sm }}
    >
      <Camera initialViewState={INITIAL_VIEW} minZoom={3} maxZoom={18} />
      {children}
    </Map>
  );
}

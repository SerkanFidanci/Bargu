import { Camera, Map, type ViewPadding } from '@maplibre/maplibre-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { useMapScheme } from './appearance';
import { INITIAL_VIEW, mapStyle } from './style';

export interface BarguMapProps {
  /** Space taken by overlays (pill, dock), so ornaments and the camera avoid them. */
  insets: ViewPadding;
  children?: ReactNode;
}

/**
 * The map behind everything. Tiles, fonts and icons come from our own server (no third party learns
 * the viewport, i.e. where the user looks). Light by day, dark at night unless the user picks one
 * (appearance.ts). The OpenStreetMap credit is drawn by MapCredit, not the native button.
 */
export function BarguMap({ insets, children }: BarguMapProps) {
  const { t } = useTranslation();
  const scheme = useMapScheme();
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
      attribution={false}
    >
      <Camera initialViewState={INITIAL_VIEW} minZoom={3} maxZoom={18} />
      {children}
    </Map>
  );
}

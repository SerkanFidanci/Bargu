import {
  Camera,
  type CameraRef,
  type LngLat,
  Map,
  type ViewPadding,
} from '@maplibre/maplibre-react-native';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { duration } from '@/theme/motion';

import { useMapScheme } from './appearance';
import { FOCUS_ZOOM, INITIAL_VIEW, mapStyle } from './style';

export interface BarguMapProps {
  /** Space taken by overlays (pill, dock), so ornaments and the camera avoid them. */
  insets: ViewPadding;
  /** Where to look once it is known (the user's own position); later changes do not move it. */
  focus?: LngLat | null;
  children?: ReactNode;
}

/**
 * The map behind everything. Tiles, fonts and icons come from our own server (no third party learns
 * the viewport, i.e. where the user looks). Light by day, dark at night unless the user picks one
 * (appearance.ts). The OpenStreetMap credit is drawn by MapCredit, not the native button.
 */
export function BarguMap({ insets, focus = null, children }: BarguMapProps) {
  const { t } = useTranslation();
  const scheme = useMapScheme();
  const camera = useRef<CameraRef>(null);
  const focused = useRef(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (focus === null || focused.current || camera.current === null) return;
    focused.current = true;
    if (reduced) camera.current.jumpTo({ center: focus, zoom: FOCUS_ZOOM });
    else camera.current.easeTo({ center: focus, zoom: FOCUS_ZOOM, duration: duration.slow });
  }, [focus, reduced]);

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
      <Camera ref={camera} initialViewState={INITIAL_VIEW} minZoom={3} maxZoom={18} />
      {children}
    </Map>
  );
}

import {
  Camera,
  type CameraRef,
  type LngLat,
  type LngLatBounds,
  Map,
  type MapRef,
  type ViewPadding,
} from '@maplibre/maplibre-react-native';
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { duration } from '@/theme/motion';
import { useEffects } from '@/theme/effects';

import { useMapScheme } from './appearance';
import { useMapZoom } from './map-zoom';
import { PLACE_LAYERS, placeName, townName } from './place-name';
import { FOCUS_ZOOM, INITIAL_VIEW, mapStyle } from './style';

export interface BarguMapProps {
  /** Space taken by overlays (pill, dock), so ornaments and the camera avoid them. */
  insets: ViewPadding;
  /** Where to look once it is known (the user's own position); later changes do not move it. */
  focus?: LngLat | null;
  children?: ReactNode;
  ref?: Ref<BarguMapHandle>;
  /** A tap on the map itself (not on a person), with where it landed. */
  onPress?: (at: { lng: number; lat: number }) => void;
  /** Every camera move, while it moves (the place editor sizes its circle with it). */
  onViewChange?: (view: { center: LngLat; zoom: number }) => void;
  /** Where the camera stopped after a move (the map's "back to me" shortcut). */
  onSettle?: (view: { center: LngLat; zoom: number }) => void;
  /** Zoom of the first focus (a street by default). */
  focusZoom?: number;
  /**
   * A map on a screen that slides in over another one (the place editor, a history): drawn in a
   * TextureView on Android, which moves with the screen's transition. The default SurfaceView
   * stays put while the screen slides and the picture looks torn (the owner, 2026-10-22). The home
   * map keeps the faster SurfaceView.
   */
  overlay?: boolean;
}

/** What the screens may ask of the map. */
export interface BarguMapHandle {
  /** Moves the camera to a point, keeping it clear of the `bottom` px a card covers. */
  focusOn(at: LngLat, bottom: number): void;
  /** Shows an area whole (a day of someone's history), clear of the `bottom` px a panel covers. */
  fitTo(bounds: LngLatBounds, bottom: number): void;
  /** The place name around a point, read from the labels the map shows (place-name.ts). */
  placeName(at: LngLat, language: string): Promise<string | null>;
  /** The town or district around a point, from the same labels (the weather card). */
  townName(at: LngLat, language: string): Promise<string | null>;
}

const MAX_ZOOM = 18;

/** How far around a point (px) the map's labels are searched for its place name. */
const PLACE_SEARCH_PX = 160;

/**
 * The map behind everything. Tiles, fonts and icons come from our own server (no third party learns
 * the viewport, i.e. where the user looks). Light by day, dark at night unless the user picks one
 * (appearance.ts). The OpenStreetMap credit is drawn by MapCredit, not the native button.
 */
export function BarguMap({
  insets,
  focus = null,
  children,
  ref,
  onPress,
  onViewChange,
  onSettle,
  focusZoom = FOCUS_ZOOM,
  overlay = false,
}: BarguMapProps) {
  const { t } = useTranslation();
  const scheme = useMapScheme();
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const focused = useRef(false);
  const reduced = useEffects() === 'off';

  useImperativeHandle(
    ref,
    () => ({
      focusOn(at, bottom) {
        const padding = { ...insets, bottom: Math.max(insets.bottom ?? 0, bottom) };
        if (reduced) camera.current?.jumpTo({ center: at, padding });
        else camera.current?.easeTo({ center: at, padding, duration: duration.slow });
      },
      fitTo(bounds, bottom) {
        // Asked to look somewhere: the first position of this phone no longer pulls the camera
        // back to it (a tapped "Güvendeyim" opening the app shows its place, ADR 0029).
        focused.current = true;
        const margin = 48;
        const padding = {
          top: (insets.top ?? 0) + margin,
          left: margin,
          right: margin,
          bottom: Math.max(insets.bottom ?? 0, bottom) + margin,
        };
        camera.current?.fitBounds(bounds, { padding, duration: reduced ? 0 : duration.slow });
      },
      async placeName(at, language) {
        const current = map.current;
        if (current === null) return null;
        const [x, y] = await current.project(at);
        const features = await current.queryRenderedFeatures(
          [
            [x - PLACE_SEARCH_PX, y - PLACE_SEARCH_PX],
            [x + PLACE_SEARCH_PX, y + PLACE_SEARCH_PX],
          ],
          { layers: PLACE_LAYERS },
        );
        return placeName(features, { lng: at[0], lat: at[1] }, language);
      },
      async townName(at, language) {
        const current = map.current;
        if (current === null) return null;
        const [x, y] = await current.project(at);
        // Towns are labelled sparsely: a wider look around than for a neighbourhood.
        const reach = PLACE_SEARCH_PX * 2;
        const features = await current.queryRenderedFeatures(
          [
            [x - reach, y - reach],
            [x + reach, y + reach],
          ],
          { layers: PLACE_LAYERS },
        );
        return townName(features, { lng: at[0], lat: at[1] }, language);
      },
    }),
    [insets, reduced],
  );

  useEffect(() => {
    if (focus === null || focused.current || camera.current === null) return;
    focused.current = true;
    if (reduced) camera.current.jumpTo({ center: focus, zoom: focusZoom });
    else camera.current.easeTo({ center: focus, zoom: focusZoom, duration: duration.slow });
  }, [focus, focusZoom, reduced]);

  return (
    <Map
      ref={map}
      testID="map"
      {...(overlay ? { androidView: 'texture' as const } : {})}
      {...(onPress === undefined
        ? {}
        : {
            onPress: (event: { nativeEvent: { lngLat: LngLat } }) => {
              const [lng, lat] = event.nativeEvent.lngLat;
              onPress({ lng, lat });
            },
          })}
      // Clusters depend on the zoom: recomputed when the map settles, not on every frame.
      onRegionDidChange={(event) => {
        useMapZoom.setState({ zoom: event.nativeEvent.zoom });
        onViewChange?.({ center: event.nativeEvent.center, zoom: event.nativeEvent.zoom });
        onSettle?.({ center: event.nativeEvent.center, zoom: event.nativeEvent.zoom });
      }}
      {...(onViewChange === undefined
        ? {}
        : {
            onRegionIsChanging: (event: { nativeEvent: { center: LngLat; zoom: number } }) => {
              onViewChange({ center: event.nativeEvent.center, zoom: event.nativeEvent.zoom });
            },
          })}
      accessibilityLabel={t('main.map')}
      style={StyleSheet.absoluteFill}
      mapStyle={mapStyle(scheme)}
      contentInset={insets}
      logo={false}
      compass={false}
      scaleBar={false}
      touchPitch={false}
      // No compass on screen to point north again: the map keeps north up (trails rely on it).
      touchRotate={false}
      attribution={false}
    >
      <Camera ref={camera} initialViewState={INITIAL_VIEW} minZoom={3} maxZoom={MAX_ZOOM} />
      {children}
    </Map>
  );
}

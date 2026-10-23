import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { useMapZoom } from '../map/map-zoom';
import { openPlace } from './open-place';
import { circleRing, type Place } from './place-model';
import { usePlaces } from './places';

/** Names show from street level; further out only the circle and its icon. */
const NAME_ZOOM = 14;

/**
 * The places of the user's circles on the map: a soft circle and the place's icon and name. A tap
 * on the tag, or inside the circle, opens the place (the owner could not reach it from the map).
 * `except` places are not drawn here at all: they are meetings, drawn their own way
 * (meeting-points-layer.tsx, docs/ADR/0026 §3), never like a saved place.
 */
export function PlacesLayer({
  only,
  except,
}: {
  only?: (place: Place) => boolean;
  except?: ReadonlySet<string>;
}) {
  const { colors } = useTheme();
  const zoom = useMapZoom((state) => state.zoom);
  const all = Object.values(usePlaces()).filter((place) => except?.has(place.id) !== true);
  const shown = only === undefined ? all : all.filter(only);
  if (shown.length === 0) return null;
  const shapes = {
    type: 'FeatureCollection' as const,
    features: shown.map((place) => ({
      type: 'Feature' as const,
      id: place.id,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [circleRing(place, place.radius)] },
    })),
  };
  return (
    <>
      <GeoJSONSource id="bargu-places" data={shapes}>
        <Layer
          id="bargu-places-fill"
          type="fill"
          paint={{ 'fill-color': colors.primary, 'fill-opacity': 0.1 }}
        />
        <Layer
          id="bargu-places-line"
          type="line"
          paint={{ 'line-color': colors.primary, 'line-width': 1.5, 'line-opacity': 0.5 }}
        />
      </GeoJSONSource>
      {shown.map((place) => (
        <Marker
          key={place.id}
          id={`place-${place.id}`}
          lngLat={[place.lng, place.lat]}
          // On Android the map hands a tap on the tag to the marker, never to the button in it.
          onPress={() => {
            openPlace(place);
          }}
        >
          {/* The tag is small; the touch area around it is a full target (a tap inside the
              circle opens the place too: the map screen's onPress). */}
          <PressableScale
            testID={`map-place-${place.id}`}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={place.name}
            onPress={() => {
              openPlace(place);
            }}
            style={styles.target}
          >
            <View style={[styles.tag, { backgroundColor: colors.surfaceRaised }]}>
              <Text variant="caption" allowFontScaling={false}>
                {place.emoji}
              </Text>
              {zoom >= NAME_ZOOM ? (
                <Text variant="caption" numberOfLines={1} style={styles.name}>
                  {place.name}
                </Text>
              ) : null}
            </View>
          </PressableScale>
        </Marker>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
    opacity: 0.92,
  },
  name: { maxWidth: 120 },
});

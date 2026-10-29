import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Text } from '@/ui/text';

import { useNow } from '../location/clock';
import { circleRing } from '../places/place-model';
import { SPOT_KEEP_MS, spotShape, useSafeSpot } from './safe-spot';

/** The dot of a place the phone knew well. */
const DOT = space.lg;
/** The name beside the dot, at most this wide. */
const TAG_MAX = space.xxxl * 4;
/**
 * The dot's box: the dot in its middle (the map anchors the middle on the place) and room on both
 * sides for the name. A box only as wide as the dot squeezed the name to nothing: an empty dark
 * pill over the friend's pin (the owner's screenshot, 2026-10-29).
 */
const BOX_WIDTH = 2 * (DOT / 2 + space.xs + TAG_MAX);

/**
 * Where somebody said "Güvendeyim" (docs/ADR/0029 §5), after their notification or line was tapped:
 * a dot for an exact place, a circle with its accuracy for a coarse one (never a dot that claims
 * more than the circle was given). A tap on the map, or a day, takes it away. Under the people.
 */
export function SafeSpotLayer() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const spot = useSafeSpot((state) => state.spot);
  const now = useNow();
  if (spot === null || now - spot.ts > SPOT_KEEP_MS) return null;
  const circle = spotShape(spot.acc) === 'circle';
  const label = [t('safe.spot', { name: spot.name }), circle ? t('safe.coarse') : null]
    .filter((part): part is string => part !== null)
    .join(', ');
  const shapes = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        id: spot.id,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [circleRing(spot, spot.acc)] },
      },
    ],
  };
  return (
    <>
      {circle ? (
        <GeoJSONSource id="bargu-safe-spot" data={shapes}>
          <Layer
            id="bargu-safe-spot-fill"
            type="fill"
            paint={{ 'fill-color': colors.success, 'fill-opacity': 0.14 }}
          />
          <Layer
            id="bargu-safe-spot-line"
            type="line"
            paint={{ 'line-color': colors.success, 'line-width': 2, 'line-opacity': 0.7 }}
          />
        </GeoJSONSource>
      ) : null}
      <Marker id="safe-spot" lngLat={[spot.lng, spot.lat]}>
        {/* The point is the middle of this box: the dot itself, or the middle of the circle. */}
        <View
          pointerEvents="none"
          accessibilityLabel={label}
          testID="safe-spot"
          style={circle ? styles.centre : styles.dotBox}
        >
          {circle ? null : (
            <View
              testID="safe-spot-dot"
              style={[
                styles.dot,
                { backgroundColor: colors.success, borderColor: colors.surfaceRaised },
              ]}
            />
          )}
          <View
            testID="safe-spot-tag"
            style={[
              styles.tag,
              circle ? null : styles.beside,
              { backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Text variant="caption" numberOfLines={2} style={styles.name}>
              {`✓ ${spot.name}`}
            </Text>
          </View>
        </View>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  dotBox: { width: BOX_WIDTH, height: DOT, alignItems: 'center', justifyContent: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  tag: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
    maxWidth: TAG_MAX,
  },
  // Right of the dot, level with it: above it stands the person's pin, below it their own line.
  beside: { position: 'absolute', left: BOX_WIDTH / 2 + DOT / 2 + space.xs },
  name: { flexShrink: 1 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: space.xxs,
  },
});

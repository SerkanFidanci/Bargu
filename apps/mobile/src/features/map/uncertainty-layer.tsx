import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

import { useTheme } from '@/theme';

import { circleRing } from '../places/place-model';
import { type GlidePoint, isRough } from './glide';

/** Someone on the map and how precise their location is (m). */
export interface Spot extends GlidePoint {
  id: string;
  acc: number;
}

/**
 * A soft circle of where someone may be when their location is rough (docs/ADR/0028): indoors a
 * phone sends its best Wi-Fi guess after a while, with its accuracy, and the map shows it as an
 * area around the pin instead of one spot (and guesses nothing ahead, glide.ts). Neighbourhood
 * and city cells have no circle: the person's card says the location is approximate.
 */
export function UncertaintyLayer({ spots }: { spots: readonly Spot[] }) {
  const { colors } = useTheme();
  const rough = spots.filter((spot) => isRough(spot.acc));
  if (rough.length === 0) return null;
  const shapes = {
    type: 'FeatureCollection' as const,
    features: rough.map((spot) => ({
      type: 'Feature' as const,
      id: spot.id,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [circleRing(spot, spot.acc)] },
    })),
  };
  return (
    <GeoJSONSource id="bargu-uncertainty" data={shapes}>
      <Layer
        id="bargu-uncertainty-fill"
        type="fill"
        paint={{ 'fill-color': colors.primary, 'fill-opacity': 0.08 }}
      />
      <Layer
        id="bargu-uncertainty-line"
        type="line"
        paint={{ 'line-color': colors.primary, 'line-width': 1, 'line-opacity': 0.35 }}
      />
    </GeoJSONSource>
  );
}

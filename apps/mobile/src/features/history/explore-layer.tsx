import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

import { useTheme } from '@/theme';

import type { Fog } from './own/explore-model';

/**
 * The discovery map's fog (docs/ADR/0030 Ek 2): the map under a soft veil, the places one has been
 * open. A layer of the map itself, drawn from squares worked out on this phone; it does not move
 * (nothing for the JS thread, nothing for sade mod to calm).
 */
export function ExploreLayer({ fog }: { fog: Fog }) {
  const { colors } = useTheme();
  const data = {
    type: 'FeatureCollection' as const,
    features: [{ type: 'Feature' as const, properties: {}, geometry: fog }],
  };
  return (
    <GeoJSONSource id="bargu-explore" data={data}>
      <Layer
        id="bargu-explore-fog"
        type="fill"
        paint={{ 'fill-color': colors.background, 'fill-opacity': 0.75, 'fill-antialias': false }}
      />
    </GeoJSONSource>
  );
}

import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

import { useTheme } from '@/theme';

import type { Segment, TracePoint } from './trail-model';

/**
 * A day of someone's history on the map: their route as a line, the places they stayed as dots.
 * Drawn from points opened on this phone; nothing about them goes to the map server.
 */
export function HistoryLayer({
  points,
  timeline,
}: {
  points: readonly TracePoint[];
  timeline: readonly Segment[];
}) {
  const { colors } = useTheme();
  if (points.length === 0) return null;
  const route = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: points.map((point) => [point.lng, point.lat]),
        },
      },
    ],
  };
  const stays = {
    type: 'FeatureCollection' as const,
    features: timeline.flatMap((segment) =>
      segment.kind === 'stay'
        ? [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: { type: 'Point' as const, coordinates: [segment.lng, segment.lat] },
            },
          ]
        : [],
    ),
  };
  return (
    <>
      <GeoJSONSource id="bargu-history-route" data={route}>
        <Layer
          id="bargu-history-route-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': colors.primary, 'line-width': 4, 'line-opacity': 0.85 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="bargu-history-stays" data={stays}>
        <Layer
          id="bargu-history-stays-dot"
          type="circle"
          paint={{
            'circle-radius': 7,
            'circle-color': colors.surfaceRaised,
            'circle-stroke-color': colors.primary,
            'circle-stroke-width': 3,
          }}
        />
      </GeoJSONSource>
    </>
  );
}

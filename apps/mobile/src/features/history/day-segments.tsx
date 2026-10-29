import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import { Bike, Car, CircleDashed, Footprints, type LucideIcon, MapPin } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { distanceM } from '@/features/location/send';
import { distanceText } from '@/features/map/distance-text';
import type { Place } from '@/features/places/place-model';
import { radius, space, useTheme } from '@/theme';
import { ListRow } from '@/ui/list-row';

import type { Segment, TracePoint } from './trail-model';

/** Where a stay was, by the circle's places (no map service is asked). */
export function placeOf(
  stay: { lat: number; lng: number },
  places: readonly Place[],
): Place | undefined {
  return places.find((place) => distanceM(place, stay) <= place.radius + 50);
}

/** The area a day's points cover, for the camera. */
export function boundsOf(points: readonly TracePoint[]): LngLatBounds | null {
  const first = points[0];
  if (first === undefined) return null;
  const bounds: LngLatBounds = [first.lng, first.lat, first.lng, first.lat];
  for (const point of points) {
    bounds[0] = Math.min(bounds[0], point.lng);
    bounds[1] = Math.min(bounds[1], point.lat);
    bounds[2] = Math.max(bounds[2], point.lng);
    bounds[3] = Math.max(bounds[3], point.lat);
  }
  return bounds;
}

/**
 * A day as its rows (docs/ADR/0019, 0030 §4): each stay with where, when and how long, each trip
 * with how far and how, and what is not known as "Kayıt yok" or "Veri yok", the latest first.
 * `names` holds names found for stays outside the user's places (stay-names.ts).
 */
export function DaySegments({
  timeline,
  places,
  names,
}: {
  timeline: readonly Segment[];
  places: readonly Place[];
  names: Readonly<Record<number, string>>;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const clock = (at: number) =>
    new Date(at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const span = (from: number, to: number) => {
    const minutes = Math.max(1, Math.round((to - from) / 60_000));
    const length =
      minutes < 60
        ? t('history.minutes', { minutes })
        : t('history.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
    return `${clock(from)} – ${clock(to)} · ${length}`;
  };
  return [...timeline].reverse().map((segment, index) => {
    let icon: LucideIcon = CircleDashed;
    let title = t('history.gap');
    if (segment.kind === 'stay') {
      const place = placeOf(segment, places);
      icon = MapPin;
      title =
        place === undefined
          ? (names[segment.from] ?? t('history.stay'))
          : `${place.emoji} ${place.name}`;
    } else if (segment.kind === 'move') {
      icon = segment.mode === 'vehicle' ? Car : segment.mode === 'bike' ? Bike : Footprints;
      title = t(`history.${segment.mode}`, {
        distance: distanceText(segment.meters, i18n.language),
      });
    }
    const Icon = icon;
    return (
      <ListRow
        key={`${segment.kind}-${String(segment.from)}-${String(index)}`}
        testID={`history-${segment.kind}`}
        leading={
          <View style={[styles.round, { backgroundColor: colors.primarySoft }]}>
            <Icon size={18} color={colors.primary} strokeWidth={2.25} />
          </View>
        }
        title={title}
        subtitle={span(segment.from, segment.to)}
      />
    );
  });
}

const styles = StyleSheet.create({
  round: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

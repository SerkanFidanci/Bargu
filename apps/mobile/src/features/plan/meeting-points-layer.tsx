import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { endClock } from '../circles/event-ui';
import { circleRing } from '../places/place-model';
import type { MeetingPoint } from './meeting-points';

/** Dash and gap of a meeting area's edge, in line widths: a meeting, not a saved place. */
const DASH = [2, 1.5];

/**
 * Meetings on the map (the project owner's request, docs/ADR/0026 §3), never like a saved place:
 * the area in coral with a dashed edge; the meeting point with a flag, the event's or circle's name
 * and the time; an event's other places, or those still voted on, lighter and smaller. A tap
 * opens the meeting's own screen. People stay on top (the people layer comes after this one).
 */
export function MeetingPointsLayer({
  points,
  now,
}: {
  points: readonly MeetingPoint[];
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  if (points.length === 0) return null;
  const areas = {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      id: `${point.circleId}:${point.place.id}`,
      properties: { set: point.state === 'set' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [circleRing(point.place, point.place.radius)],
      },
    })),
  };
  const open = (circleId: string) => {
    router.push({ pathname: '/meeting/[circleId]', params: { circleId } });
  };
  return (
    <>
      <GeoJSONSource id="bargu-meetings" data={areas}>
        <Layer
          id="bargu-meetings-fill"
          type="fill"
          paint={{
            'fill-color': colors.accent,
            'fill-opacity': ['case', ['get', 'set'], 0.16, 0.07],
          }}
        />
        <Layer
          id="bargu-meetings-line"
          type="line"
          paint={{
            'line-color': colors.accent,
            'line-width': ['case', ['get', 'set'], 2.5, 1.5],
            'line-dasharray': DASH,
          }}
        />
      </GeoJSONSource>
      {points.map((point) => {
        const key = `${point.circleId}:${point.place.id}`;
        if (point.state !== 'set') {
          return (
            <Marker key={key} id={`meeting-${key}`} lngLat={[point.place.lng, point.place.lat]}>
              <PressableScale
                testID={`meeting-option-${point.place.id}`}
                haptic="select"
                accessibilityRole="button"
                accessibilityLabel={t('meeting.optionLabel', {
                  title: point.title,
                  place: point.place.name,
                })}
                onPress={() => {
                  open(point.circleId);
                }}
                style={[styles.option, { backgroundColor: colors.surfaceRaised }]}
              >
                <Flag color={colors.accent} size={14} strokeWidth={2.5} />
                <Text variant="caption" numberOfLines={1} style={styles.optionText}>
                  {point.place.emoji} {point.place.name}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {point.state === 'voting' ? t('meeting.voting') : t('meeting.option')}
                </Text>
              </PressableScale>
            </Marker>
          );
        }
        const time = point.meetAt === undefined ? null : endClock(point.meetAt, now, i18n.language);
        return (
          <Marker
            key={key}
            id={`meeting-${key}`}
            lngLat={[point.place.lng, point.place.lat]}
            anchor="bottom"
          >
            <PressableScale
              testID={`meeting-point-${point.circleId}`}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={t('plan.meetingPoint', {
                event: point.title,
                place: point.place.name,
                time: time ?? t('plan.noTime'),
              })}
              onPress={() => {
                open(point.circleId);
              }}
              style={styles.pin}
            >
              <View style={[styles.flag, { backgroundColor: colors.accent }]}>
                <Flag color={colors.onAccent} size={16} strokeWidth={2.5} />
                <View style={styles.text}>
                  <Text variant="caption" numberOfLines={1} style={{ color: colors.onAccent }}>
                    {point.place.emoji} {point.place.name}
                  </Text>
                  <Text variant="caption" numberOfLines={1} style={{ color: colors.onAccent }}>
                    {[time, point.title].filter((part) => part !== null && part !== '').join(' · ')}
                  </Text>
                </View>
              </View>
              <View style={[styles.stem, { backgroundColor: colors.accent }]} />
            </PressableScale>
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center', minHeight: touchTarget },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.lg,
  },
  text: { maxWidth: 180 },
  stem: { width: space.xxs, height: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    minHeight: touchTarget,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  optionText: { maxWidth: 120 },
});

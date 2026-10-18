import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { endClock } from '../circles/event-ui';
import { useMapZoom } from '../map/map-zoom';
import { circleRing } from '../places/place-model';
import { groupMeetingPoints, type MeetingPoint, pointKey } from './meeting-points';

/** Dash and gap of a meeting area's edge, in line widths: a meeting, not a saved place. */
const DASH = [2, 1.5];
/** Rows in one card of meetings standing together; more are counted. */
export const STACK_MAX = 4;

const open = (circleId: string) => {
  router.push({ pathname: '/meeting/[circleId]', params: { circleId } });
};

/**
 * Meetings on the map (the project owner's request, docs/ADR/0026 §3), never like a saved place:
 * the area in coral with a dashed edge; the meeting point with a flag, the event's or circle's name
 * and the time; an event's other places, or those still voted on, lighter and smaller. Tags that
 * would overlap at the map's zoom share one card, a row each, every row its own tap (the owner,
 * 2026-10-18: one hid the other). A tap opens the meeting's own screen. People stay on top (the
 * people layer comes after this one).
 */
export function MeetingPointsLayer({
  points,
  now,
}: {
  points: readonly MeetingPoint[];
  now: number;
}) {
  const { colors } = useTheme();
  const zoom = useMapZoom((state) => state.zoom);
  if (points.length === 0) return null;
  const areas = {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      id: pointKey(point),
      properties: { set: point.state === 'set' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [circleRing(point.place, point.place.radius)],
      },
    })),
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
            // Places not chosen yet stay in the background, also where their areas cross.
            'line-opacity': ['case', ['get', 'set'], 1, 0.55],
            'line-dasharray': DASH,
          }}
        />
      </GeoJSONSource>
      {groupMeetingPoints(points, zoom).map((group) => {
        const [only] = group.points;
        if (group.points.length === 1 && only !== undefined) {
          return <MeetingTag key={group.key} point={only} now={now} />;
        }
        return (
          <Marker key={group.key} id={`meetings-${group.key}`} lngLat={[group.lng, group.lat]}>
            <MeetingStack points={group.points} now={now} />
          </Marker>
        );
      })}
    </>
  );
}

/** One meeting alone: its flag above the point, or a light tag on an event's other place. */
function MeetingTag({ point, now }: { point: MeetingPoint; now: number }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const key = pointKey(point);
  if (point.state !== 'set') {
    return (
      <Marker id={`meeting-${key}`} lngLat={[point.place.lng, point.place.lat]}>
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
    <Marker id={`meeting-${key}`} lngLat={[point.place.lng, point.place.lat]} anchor="bottom">
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
}

/**
 * Meetings standing together: one card, a row each, every row a full touch target that opens its
 * meeting; the meeting itself first and in coral, then the places voted on, then the others.
 */
export function MeetingStack({ points, now }: { points: readonly MeetingPoint[]; now: number }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const shown = points.slice(0, STACK_MAX);
  const more = points.length - shown.length;
  return (
    <View
      testID="meeting-stack"
      style={[styles.stack, { backgroundColor: colors.surfaceRaised, borderColor: colors.accent }]}
    >
      {shown.map((point, index) => {
        const set = point.state === 'set';
        const time =
          set && point.meetAt !== undefined ? endClock(point.meetAt, now, i18n.language) : null;
        const status = set
          ? (time ?? t('plan.noTime'))
          : point.state === 'voting'
            ? t('meeting.voting')
            : t('meeting.option');
        return (
          <Fragment key={pointKey(point)}>
            {index === 0 ? null : (
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            )}
            <PressableScale
              testID={set ? `meeting-point-${point.circleId}` : `meeting-option-${point.place.id}`}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={
                set
                  ? t('plan.meetingPoint', {
                      event: point.title,
                      place: point.place.name,
                      time: time ?? t('plan.noTime'),
                    })
                  : t('meeting.optionLabel', { title: point.title, place: point.place.name })
              }
              onPress={() => {
                open(point.circleId);
              }}
              style={[styles.row, set ? { backgroundColor: colors.accent } : null]}
            >
              <Flag color={set ? colors.onAccent : colors.accent} size={14} strokeWidth={2.5} />
              <Text
                variant="caption"
                numberOfLines={1}
                style={[styles.optionText, set ? { color: colors.onAccent } : null]}
              >
                {point.place.emoji} {point.place.name}
              </Text>
              <Text
                variant="caption"
                color="textMuted"
                numberOfLines={1}
                style={set ? { color: colors.onAccent } : null}
              >
                {status}
              </Text>
            </PressableScale>
          </Fragment>
        );
      })}
      {more > 0 ? (
        <Text variant="caption" color="textMuted" style={styles.more}>
          {t('meeting.chip.more', { count: more })}
        </Text>
      ) : null}
    </View>
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
  stack: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: touchTarget,
    paddingHorizontal: space.md,
  },
  divider: { height: StyleSheet.hairlineWidth },
  more: { paddingHorizontal: space.md, paddingVertical: space.xs, textAlign: 'center' },
});

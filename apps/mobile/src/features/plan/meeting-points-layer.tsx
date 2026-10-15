import { Marker } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { endClock } from '../circles/event-ui';
import type { MeetingPoint } from './meeting-points';

/**
 * Events' meeting points on the map, unlike an ordinary place: a coral flag with the event's
 * name and the meeting time. A tap opens the event, where the meeting and who gets there when
 * are (QA Faz 8, the project owner's request).
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
  return (
    <>
      {points.map((point) => {
        const time = point.meetAt === undefined ? null : endClock(point.meetAt, now, i18n.language);
        return (
          <Marker
            key={point.circleId}
            id={`meeting-${point.circleId}`}
            lngLat={[point.place.lng, point.place.lat]}
            anchor="bottom"
          >
            <PressableScale
              testID={`meeting-point-${point.circleId}`}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={t('plan.meetingPoint', {
                event: point.event,
                place: point.place.name,
                time: time ?? t('plan.noTime'),
              })}
              onPress={() => {
                router.push({ pathname: '/circle/[id]', params: { id: point.circleId } });
              }}
              style={styles.pin}
            >
              <View style={[styles.flag, { backgroundColor: colors.accent }]}>
                <Flag color={colors.onAccent} size={16} strokeWidth={2.5} />
                <View style={styles.text}>
                  <Text variant="caption" numberOfLines={1} style={{ color: colors.onAccent }}>
                    {point.place.emoji} {point.event}
                  </Text>
                  {time === null ? null : (
                    <Text variant="caption" numberOfLines={1} style={{ color: colors.onAccent }}>
                      {time}
                    </Text>
                  )}
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
  text: { maxWidth: 160 },
  stem: { width: space.xxs, height: space.sm },
});

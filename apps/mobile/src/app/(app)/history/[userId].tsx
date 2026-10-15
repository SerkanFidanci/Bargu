import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Bike,
  Car,
  CircleDashed,
  Footprints,
  History as HistoryIcon,
  type LucideIcon,
  MapPin,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircle } from '@/features/circles/queries';
import { useHistoryPings } from '@/features/history/history-api';
import { HistoryLayer } from '@/features/history/history-layer';
import {
  dayStart,
  historyDays,
  type Segment,
  segments,
  type TracePoint,
} from '@/features/history/trail-model';
import { useNow } from '@/features/location/clock';
import { history } from '@/features/location/location-session';
import { distanceM } from '@/features/location/send';
import { BarguMap, type BarguMapHandle } from '@/features/map/bargu-map';
import { distanceText } from '@/features/map/distance-text';
import type { Place } from '@/features/places/place-model';
import { usePlaces } from '@/features/places/places';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';

const DAY_MS = 24 * 60 * 60_000;

/** Where a stay was, by the circle's places (no map service is asked). */
function placeOf(stay: { lat: number; lng: number }, places: readonly Place[]): Place | undefined {
  return places.find((place) => distanceM(place, stay) <= place.radius + 50);
}

/** The area a day's points cover, for the camera. */
function boundsOf(points: readonly TracePoint[]): LngLatBounds | null {
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
 * A member's location history over a day (docs/ADR/0019): the route on the map and the day as
 * stays and trips, the last week to choose from. Opened on this phone from pieces only the
 * circle's members of that time can read; nobody sees history from before they joined.
 */
export default function HistoryScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { userId, circleId } = useLocalSearchParams<{ userId: string; circleId: string }>();
  const me = useAuth((state) => state.userId);
  const circle = useCircle(circleId);
  const member = circle?.members.find((candidate) => candidate.userId === userId);
  const places = Object.values(usePlaces()).filter((place) => place.circleId === circleId);
  const now = useNow();
  const days = historyDays(now);
  const [day, setDay] = useState(dayStart(now));
  const ping = useHistoryPings((state) => state[`${circleId}:${userId}`] ?? 0);
  const [result, setResult] = useState<{ key: string; points: TracePoint[] } | null>(null);
  const [panel, setPanel] = useState(0);
  const map = useRef<BarguMapHandle>(null);
  const key = `${circleId}:${userId}:${String(day)}:${String(ping)}`;

  useEffect(() => {
    let alive = true;
    history
      .load(circleId, userId, day, day + DAY_MS)
      .then((points) => {
        if (alive) setResult({ key, points });
      })
      .catch(() => {
        if (alive) setResult({ key, points: [] });
      });
    return () => {
      alive = false;
    };
  }, [circleId, userId, day, key]);

  const points = useMemo(() => result?.points ?? [], [result]);
  const loading = result?.key !== key;
  const timeline = useMemo(() => segments(points), [points]);

  useEffect(() => {
    const bounds = boundsOf(points);
    if (bounds !== null) map.current?.fitTo(bounds, panel);
  }, [points, panel]);

  const name = userId === me ? t('history.me') : member === undefined ? '' : memberName(member);
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
  const dayLabel = (start: number, index: number) =>
    index === 0
      ? t('history.today')
      : index === 1
        ? t('history.yesterday')
        : new Date(start).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' });

  const row = (segment: Segment, index: number) => {
    let icon: LucideIcon = CircleDashed;
    let title = t('history.gap');
    if (segment.kind === 'stay') {
      const place = placeOf(segment, places);
      icon = MapPin;
      title = place === undefined ? t('history.stay') : `${place.emoji} ${place.name}`;
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
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="history-screen">
      <View style={styles.map}>
        <BarguMap ref={map} insets={{ top: insets.top }}>
          <HistoryLayer points={points} timeline={timeline} />
        </BarguMap>
        <View style={[styles.close, { top: insets.top + space.sm }]}>
          <IconButton
            icon={X}
            label={t('common.close')}
            onPress={() => {
              router.back();
            }}
          />
        </View>
      </View>
      <View
        style={[styles.panel, { backgroundColor: colors.surface }]}
        onLayout={(event) => {
          setPanel(event.nativeEvent.layout.height);
        }}
      >
        <View style={styles.header}>
          {member === undefined ? null : (
            <Avatar avatar={member.avatar} name={name} userId={member.userId} />
          )}
          <View style={styles.titles}>
            <Text variant="title2" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('history.title')}
            </Text>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.days}
        >
          {days.map((start, index) => {
            const chosen = start === day;
            return (
              <PressableScale
                key={start}
                testID={`history-day-${String(index)}`}
                haptic="select"
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={dayLabel(start, index)}
                onPress={() => {
                  setDay(start);
                }}
                style={[
                  styles.day,
                  { backgroundColor: chosen ? colors.primary : colors.surfaceRaised },
                ]}
              >
                <Text variant="subhead" style={{ color: chosen ? colors.onPrimary : colors.text }}>
                  {dayLabel(start, index)}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
        <ScrollView
          style={styles.list}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.lg }]}
        >
          {loading ? (
            <>
              <Skeleton width="100%" height={space.xxxl} />
              <Skeleton width="100%" height={space.xxxl} />
            </>
          ) : timeline.length === 0 ? (
            <EmptyState
              icon={HistoryIcon}
              title={t('history.empty')}
              body={userId === me ? t('history.emptyMine') : t('history.emptyTheirs')}
            />
          ) : (
            [...timeline].reverse().map(row)
          )}
          <Text variant="caption" color="textMuted">
            {t('history.privacy')}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  close: { position: 'absolute', left: space.lg },
  panel: {
    maxHeight: '55%',
    paddingTop: space.lg,
    gap: space.md,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
  },
  titles: { flex: 1 },
  days: { gap: space.sm, paddingHorizontal: space.xl },
  day: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  list: { flexGrow: 0 },
  content: { paddingHorizontal: space.xl, gap: space.xs },
  round: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

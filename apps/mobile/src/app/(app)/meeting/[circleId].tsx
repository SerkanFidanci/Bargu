import type { Circle } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Flag, Navigation, Plus, Users } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { endClock } from '@/features/circles/event-ui';
import { memberName } from '@/features/circles/names';
import { useCircle } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import type { Place } from '@/features/places/place-model';
import { usePlaces } from '@/features/places/places';
import { docKey, useDocs } from '@/features/plan/docs';
import { MeetingCard } from '@/features/plan/meeting-card';
import { PlaceIcon, TimeStepper, timeRange, useEventPlaces } from '@/features/plan/meeting-sheets';
import { startMeeting } from '@/features/plan/plan-actions';
import { MEETING } from '@/features/plan/plan-model';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';

/** How a circle is named on the meeting: a friendship by the friend, a group by its name. */
function circleTitle(circle: Circle, me: string | null): string {
  if (circle.kind !== 'pair') return circle.name ?? '';
  const friend = circle.members.find((member) => member.userId !== me);
  return friend === undefined ? '' : memberName(friend);
}

/**
 * Opens the phone's maps app with the way to the meeting place (docs/ADR/0026 §4): only on a tap,
 * and only then do the place's coordinates leave Bargu, to the app the person chose.
 */
function openDirections(place: Pick<Place, 'lat' | 'lng'>): void {
  const at = `${String(place.lat)},${String(place.lng)}`;
  const url = Platform.OS === 'ios' ? `maps://?daddr=${at}` : `geo:${at}?q=${at}`;
  void Linking.openURL(url).catch(() => undefined);
}

/**
 * A meeting's own screen (the project owner's request, docs/ADR/0026 §4): where and when, who
 * started it, who gets there when, the way there; outside an event, starting one when the circle
 * has none.
 */
export default function MeetingScreen() {
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const { t, i18n } = useTranslation();
  const me = useAuth((state) => state.userId);
  const circle = useCircle(circleId);
  const docs = useDocs();
  const places = usePlaces();
  const now = useNow();

  if (circle?.myStatus !== 'active') {
    return (
      <Screen title={t('meeting.title')}>
        <EmptyState icon={Flag} title={t('meeting.gone')} body={t('meeting.goneBody')} />
      </Screen>
    );
  }
  const plan = docs[docKey(circle.id, circle.id)]?.payload;
  const meeting = plan?.kind === 'plan' ? plan : undefined;
  const place = meeting?.placeId === undefined ? undefined : places[meeting.placeId];
  const event = circle.kind === 'event';
  const title = circleTitle(circle, me);

  if (!event && meeting === undefined) {
    return (
      <Screen title={t('meeting.startTitle')} subtitle={title}>
        <StartMeeting circle={circle} />
      </Screen>
    );
  }

  return (
    <Screen title={t('meeting.title')} subtitle={title}>
      <View testID="meeting-screen" style={styles.head}>
        <View style={styles.where}>
          {place === undefined ? null : <PlaceIcon emoji={place.emoji} />}
          <View style={styles.whereText}>
            <Text variant="title2" numberOfLines={2}>
              {place?.name ?? t('plan.noPlace')}
            </Text>
            <Text variant="callout" color="textMuted">
              {meeting?.meetAt === undefined
                ? t('plan.noTime')
                : endClock(meeting.meetAt, now, i18n.language)}
            </Text>
          </View>
        </View>
        {place === undefined ? null : (
          <Button
            testID="meeting-directions"
            label={t('meeting.directions')}
            icon={Navigation}
            variant="secondary"
            onPress={() => {
              openDirections(place);
            }}
          />
        )}
        {place === undefined ? null : (
          <Text variant="caption" color="textMuted">
            {t('meeting.directionsHint')}
          </Text>
        )}
      </View>
      <MeetingCard circle={circle} />
      {event ? (
        <ListRow
          testID="meeting-open-event"
          leading={<Users size={20} />}
          title={t('meeting.openEvent')}
          onPress={() => {
            router.push({ pathname: '/circle/[id]', params: { id: circle.id } });
          }}
        />
      ) : null}
    </Screen>
  );
}

/** Starting a meeting in a circle that is no event: one of its places, and a time. */
function StartMeeting({ circle }: { circle: Circle }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const circlePlaces = useEventPlaces(circle.id);
  const range = timeRange(circle, now);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [meetAt, setMeetAt] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const chosenTime =
    meetAt ?? (range === null ? now : Math.min(range.max, range.min + MEETING.stepMs));
  const start = async () => {
    if (placeId === null) return;
    setStarting(true);
    await startMeeting(circle, { placeId, meetAt: chosenTime });
    setStarting(false);
  };

  return (
    <View style={styles.start} testID="meeting-start">
      <Text variant="callout" color="textMuted">
        {t(circle.kind === 'pair' ? 'meeting.startBodyPair' : 'meeting.startBody')}
      </Text>
      <SectionTitle>{t('plan.placeTitle')}</SectionTitle>
      {circlePlaces.length === 0 ? (
        <Text variant="body" color="textMuted">
          {t('meeting.noPlaces')}
        </Text>
      ) : (
        circlePlaces.map((place) => (
          <ListRow
            key={place.id}
            testID={`meeting-start-place-${place.id}`}
            leading={<PlaceIcon emoji={place.emoji} />}
            title={place.name}
            subtitle={t('places.meters', { meters: place.radius })}
            trailing={
              place.id === placeId ? (
                <View style={[styles.chosen, { backgroundColor: colors.primary }]} />
              ) : null
            }
            onPress={() => {
              setPlaceId(place.id);
            }}
          />
        ))
      )}
      <Button
        testID="meeting-start-add-place"
        label={t('plan.addPlace')}
        icon={Plus}
        variant="secondary"
        onPress={() => {
          router.push({ pathname: '/place/[circleId]', params: { circleId: circle.id } });
        }}
      />
      <SectionTitle>{t('plan.time')}</SectionTitle>
      {range === null ? null : (
        <TimeStepper value={chosenTime} onChange={setMeetAt} min={range.min} max={range.max} />
      )}
      <Button
        testID="meeting-start-go"
        label={t('meeting.start')}
        icon={Flag}
        disabled={placeId === null || range === null}
        loading={starting}
        onPress={() => {
          void start();
        }}
      />
      <Text variant="caption" color="textMuted">
        {t('meeting.startHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm },
  where: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  whereText: { flex: 1, gap: space.xxs },
  start: { gap: space.sm },
  chosen: { width: space.md, height: space.md, borderRadius: radius.pill },
});

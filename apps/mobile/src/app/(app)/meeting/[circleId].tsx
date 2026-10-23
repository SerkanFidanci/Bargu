import type { Circle, PlanPayload } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Flag, MapPin, Users } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircle } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import { usePlaces } from '@/features/places/places';
import { docKey, useDocs } from '@/features/plan/docs';
import { meetingOf } from '@/features/plan/meeting';
import { MeetingCard } from '@/features/plan/meeting-card';
import { useMeetingPlaceDraft } from '@/features/plan/meeting-place';
import { PlaceIcon, TimeStepper, timeRange, useEventPlaces } from '@/features/plan/meeting-sheets';
import {
  MeetingAnswerCard,
  MeetingHero,
  MeetingManageCard,
  MeetingPeopleCard,
  MeetingWayCard,
} from '@/features/plan/meeting-view';
import {
  forgetMeetingPlace,
  mayRunMeeting,
  setMeeting,
  startMeeting,
} from '@/features/plan/plan-actions';
import { MEETING, meetingSpots } from '@/features/plan/plan-model';
import { space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { EmptyState } from '@/ui/empty-state';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';

/** How a circle is named on the meeting: a friendship by the friend, a group by its name. */
function circleTitle(circle: Circle, me: string | null): string {
  if (circle.kind !== 'pair') return circle.name ?? '';
  const friend = circle.members.find((member) => member.userId !== me);
  return friend === undefined ? '' : memberName(friend);
}

/**
 * A meeting's own screen (the project owner's request, docs/ADR/0026 §4): where and when, who
 * started it, who gets there when, the way there; outside an event, starting one when the circle
 * has none, and "Düzenle" for whoever may change it (the owner, 2026-10-23).
 */
export default function MeetingScreen() {
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const { t } = useTranslation();
  const me = useAuth((state) => state.userId);
  const circle = useCircle(circleId);
  const docs = useDocs();
  const places = usePlaces();
  const now = useNow();
  const [editing, setEditing] = useState(false);

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

  // Outside an event the meeting is its starter's and the admins' to change (docs/ADR/0026).
  const mayChange = !event && me !== null && mayRunMeeting(circle, me);

  if (!event && meeting === undefined) {
    return (
      <Screen title={t('meeting.startTitle')} subtitle={title}>
        <MeetingForm circle={circle} />
      </Screen>
    );
  }
  if (editing && mayChange && meeting !== undefined) {
    return (
      <Screen title={t('meeting.editTitle')} subtitle={title}>
        <MeetingForm
          circle={circle}
          current={meeting}
          onDone={() => {
            setEditing(false);
          }}
        />
      </Screen>
    );
  }

  const shown = meetingOf(circle.id, docs, places);
  const openForm = () => {
    setEditing(true);
  };
  return (
    <Screen title={t('meeting.title')} subtitle={title}>
      <MeetingHero
        circle={circle}
        me={me}
        place={place}
        meetAt={meeting?.meetAt}
        now={now}
        mayChange={mayChange}
        onEdit={openForm}
      />
      {event || me === null ? null : <MeetingAnswerCard circle={circle} me={me} />}
      {event || me === null ? null : (
        <MeetingPeopleCard circle={circle} meeting={shown} me={me} now={now} />
      )}
      {!event && shown !== null && now <= shown.meetAt + MEETING.etaUntilMs ? (
        <MeetingWayCard circleId={circle.id} />
      ) : null}
      {mayChange ? <MeetingManageCard circle={circle} /> : null}
      {event ? <MeetingCard circle={circle} /> : null}
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

/**
 * Starting a meeting in a circle that is no event, or changing it (`current`): where and when.
 * Where: a spot picked on the map for this meeting only, which goes with it (the owner, 2026-10-23:
 * meeting at Taksim should not leave Taksim behind as a place), or one of the circle's places.
 */
function MeetingForm({
  circle,
  current,
  onDone,
}: {
  circle: Circle;
  current?: PlanPayload;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const docs = useDocs();
  const circlePlaces = useEventPlaces(circle.id);
  const range = timeRange(circle, now);
  const [placeId, setPlaceId] = useState<string | null>(current?.placeId ?? null);
  // A spot picked here (docs/ADR/0026 Ek 1): taken at once. One left unused (another picked, or
  // the form left without saving) goes at once, so it never stays behind as a place.
  const [added, setAdded] = useState<string | null>(null);
  const addedRef = useRef<string | null>(null);
  const used = useRef(false);
  useEffect(
    () =>
      useMeetingPlaceDraft.subscribe((draft) => {
        if (draft?.circleId !== circle.id) return;
        const before = addedRef.current;
        if (before !== null && before !== draft.placeId) void forgetMeetingPlace(before);
        addedRef.current = draft.placeId;
        setAdded(draft.placeId);
        setPlaceId(draft.placeId);
        useMeetingPlaceDraft.setState(null, true);
      }),
    [circle.id],
  );
  useEffect(
    () => () => {
      const left = addedRef.current;
      if (left !== null && !used.current) void forgetMeetingPlace(left);
    },
    [],
  );
  const [meetAt, setMeetAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const chosenTime =
    meetAt ??
    current?.meetAt ??
    (range === null ? now : Math.min(range.max, range.min + MEETING.stepMs));
  // The spot this meeting has now, or the one just picked; the circle's own places below it.
  const spots = meetingSpots(docs);
  const spotId = added ?? (current?.placeGoes === true ? current.placeId : undefined);
  const spot = circlePlaces.find((place) => place.id === spotId);
  const saved = circlePlaces.filter((place) => place.id !== spotId && !spots.has(place.id));

  const save = async () => {
    if (placeId === null) return;
    setSaving(true);
    const isSpot = placeId === added;
    // Marked before the answer: the screen may turn to the meeting before the answer arrives.
    used.current = isSpot;
    const done =
      current === undefined
        ? await startMeeting(circle, {
            placeId,
            meetAt: chosenTime,
            ...(isSpot ? { placeGoes: true } : {}),
          })
        : await setMeeting(circle.id, {
            placeId,
            meetAt: chosenTime,
            ...(isSpot ? { spot: true } : {}),
          });
    setSaving(false);
    if (!done) {
      used.current = false;
      return;
    }
    onDone?.();
  };

  const chosenMark = (id: string) =>
    id === placeId ? <Check size={20} color={colors.primary} strokeWidth={2.5} /> : null;

  return (
    <View style={styles.start} testID={current === undefined ? 'meeting-start' : 'meeting-form'}>
      <Card title={t('meeting.where')}>
        {spot === undefined ? null : (
          <ListRow
            testID="meeting-start-spot"
            leading={<PlaceIcon emoji={spot.emoji} />}
            title={spot.name}
            subtitle={t('meeting.spotOnly')}
            trailing={chosenMark(spot.id)}
            onPress={() => {
              setPlaceId(spot.id);
            }}
          />
        )}
        <Button
          testID="meeting-start-add-place"
          label={t(spot === undefined ? 'meeting.pickSpot' : 'meeting.pickOtherSpot')}
          icon={MapPin}
          variant={spot === undefined && saved.length === 0 ? 'primary' : 'secondary'}
          onPress={() => {
            router.push({
              pathname: '/place/[circleId]',
              params: { circleId: circle.id, forMeeting: '1' },
            });
          }}
        />
        <Text variant="caption" color="textMuted">
          {t('meeting.pickSpotHint')}
        </Text>
        {saved.length === 0 ? null : (
          <Text variant="subhead" color="textMuted">
            {t('meeting.orSaved')}
          </Text>
        )}
        {saved.map((place) => (
          <ListRow
            key={place.id}
            testID={`meeting-start-place-${place.id}`}
            leading={<PlaceIcon emoji={place.emoji} />}
            title={place.name}
            subtitle={t('places.meters', { meters: place.radius })}
            trailing={chosenMark(place.id)}
            onPress={() => {
              setPlaceId(place.id);
            }}
          />
        ))}
      </Card>
      <Card title={t('meeting.when')}>
        {range === null ? null : (
          <TimeStepper value={chosenTime} onChange={setMeetAt} min={range.min} max={range.max} />
        )}
      </Card>
      <Button
        testID="meeting-start-go"
        label={t(current === undefined ? 'meeting.start' : 'plan.save')}
        icon={current === undefined ? Flag : Check}
        disabled={placeId === null || range === null}
        loading={saving}
        onPress={() => {
          void save();
        }}
      />
      {current === undefined ? (
        <Text variant="caption" color="textMuted" align="center">
          {`${t(circle.kind === 'pair' ? 'meeting.startBodyPair' : 'meeting.startBody')} ${t('meeting.startHint')}`}
        </Text>
      ) : (
        <Button
          testID="meeting-form-cancel"
          label={t('common.cancel')}
          variant="ghost"
          onPress={() => {
            onDone?.();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  start: { gap: space.md },
});

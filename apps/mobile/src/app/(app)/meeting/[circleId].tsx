import type { Circle, MeetingSpot, PlanPayload } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Flag, MapPin, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircle } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import { usePlaces } from '@/features/places/places';
import { docKey, useDocs } from '@/features/plan/docs';
import { meetingOf, meetingPlace, SPOT_EMOJI } from '@/features/plan/meeting';
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
  mayRunMeeting,
  type MeetingWhere,
  setMeeting,
  startMeeting,
} from '@/features/plan/plan-actions';
import { MEETING } from '@/features/plan/plan-model';
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
  const place = meeting === undefined ? undefined : meetingPlace(meeting, places);
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
  const saved = useEventPlaces(circle.id);
  const range = timeRange(circle, now);
  // Where: a saved place, or the spot picked on the map (docs/ADR/0026 Ek 1), which lives in the
  // meeting only: nothing is saved before the meeting is, and nothing is left if it is not.
  const [spot, setSpot] = useState<MeetingSpot | undefined>(current?.spot);
  const [where, setWhere] = useState<MeetingWhere | null>(
    current?.spot !== undefined
      ? { spot: current.spot }
      : current?.placeId !== undefined
        ? { placeId: current.placeId }
        : null,
  );
  useEffect(
    () =>
      useMeetingPlaceDraft.subscribe((draft) => {
        if (draft?.circleId !== circle.id) return;
        setSpot(draft.spot);
        setWhere({ spot: draft.spot });
        useMeetingPlaceDraft.setState(null, true);
      }),
    [circle.id],
  );
  const [meetAt, setMeetAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const chosenTime =
    meetAt ??
    current?.meetAt ??
    (range === null ? now : Math.min(range.max, range.min + MEETING.stepMs));

  const save = async () => {
    if (where === null) return;
    setSaving(true);
    const done =
      current === undefined
        ? await startMeeting(circle, { ...where, meetAt: chosenTime })
        : await setMeeting(circle.id, { ...where, meetAt: chosenTime });
    setSaving(false);
    if (done) onDone?.();
  };

  const chosenMark = (chosen: boolean) =>
    chosen ? <Check size={20} color={colors.primary} strokeWidth={2.5} /> : null;
  const spotChosen = where !== null && 'spot' in where;

  return (
    <View style={styles.start} testID={current === undefined ? 'meeting-start' : 'meeting-form'}>
      <Card title={t('meeting.where')}>
        {spot === undefined ? null : (
          <ListRow
            testID="meeting-start-spot"
            leading={<PlaceIcon emoji={SPOT_EMOJI} />}
            title={spot.name}
            subtitle={t('meeting.spotOnly')}
            trailing={chosenMark(spotChosen)}
            onPress={() => {
              setWhere({ spot });
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
            trailing={chosenMark(
              where !== null && 'placeId' in where && where.placeId === place.id,
            )}
            onPress={() => {
              setWhere({ placeId: place.id });
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
        disabled={where === null || range === null}
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

import type { Circle } from '@bargu/schemas';
import type { TFunction } from 'i18next';
import {
  CircleCheck,
  Flag,
  Hourglass,
  MapPin,
  Navigation,
  Pencil,
  Square,
} from 'lucide-react-native';
import { type Ref, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { ActionTile } from '@/ui/action-tile';
import { Avatar } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { ListRow } from '@/ui/list-row';
import { Segmented } from '@/ui/segmented';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

import { endClock } from '../circles/event-ui';
import { memberName } from '../circles/names';
import { meetings, sayArrived } from '../location/location-session';
import { BarguMap } from '../map/bargu-map';
import type { Place } from '../places/place-model';
import { docKey, useDocs } from './docs';
import { type Meeting, useMeetingChoices } from './meeting';
import { answerMeeting, endMeeting } from './plan-actions';
import {
  type Arrival,
  answerCounts,
  answersOf,
  inEtaWindow,
  MEETING,
  MEETING_ANSWERS,
  type MeetingAnswer,
  starterOf,
  type TravelMode,
} from './plan-model';
import { useArrivals } from './use-arrivals';

/** How close the small map looks at the meeting's place. */
const MINI_MAP_ZOOM = 15;

/**
 * Opens the phone's maps app with the way to the meeting place (docs/ADR/0026 §4): only on a tap,
 * and only then do the place's coordinates leave Bargu, to the app the person chose.
 */
function openDirections(place: Pick<Place, 'lat' | 'lng'>): void {
  const at = `${String(place.lat)},${String(place.lng)}`;
  const url = Platform.OS === 'ios' ? `maps://?daddr=${at}` : `geo:${at}?q=${at}`;
  void Linking.openURL(url).catch(() => undefined);
}

/** "2 sa 10 dk kaldı" up to a day ahead; "Başladı" from its time on. */
function timeLeft(meetAt: number, now: number, t: TFunction): string | null {
  const minutes = Math.ceil((meetAt - now) / 60_000);
  if (minutes <= 0) return t('meeting.left.started');
  if (minutes < 60) return t('meeting.left.minutes', { minutes });
  if (minutes < 24 * 60) {
    return t('meeting.left.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  }
  return null;
}

/**
 * The top of a meeting's screen (the owner, 2026-10-23: the screen said nothing at a glance): a
 * small map of where, the place and the time with what is left, who started it; under it the
 * actions side by side.
 */
export function MeetingHero({
  circle,
  me,
  place,
  meetAt,
  now,
  mayChange,
  onEdit,
}: {
  circle: Circle;
  me: string | null;
  place: Place | undefined;
  meetAt: number | undefined;
  now: number;
  mayChange: boolean;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const docs = useDocs();
  const event = circle.kind === 'event';
  const doc = docs[docKey(circle.id, circle.id)];
  const plan = doc?.payload.kind === 'plan' ? doc.payload : undefined;
  const startedBy = event ? undefined : starterOf(doc);
  const starter = circle.members.find((member) => member.userId === startedBy);
  const left = meetAt === undefined ? null : timeLeft(meetAt, now, t);
  const when =
    meetAt === undefined
      ? t('plan.noTime')
      : [endClock(meetAt, now, i18n.language), left].filter((part) => part !== null).join(' · ');
  // "Geç kalacağım" and "Geldim" until half an hour after its time (docs/ADR/0026 §5).
  const onTheWay = !event && meetAt !== undefined && now <= meetAt + MEETING.etaUntilMs;
  const lateSheet = useRef<SheetRef>(null);
  const [here, setHere] = useState(false);
  const sayHere = async () => {
    if (meetAt === undefined) return;
    setHere(true);
    try {
      await sayArrived(circle, meetAt);
      toast.success(t('meeting.hereSent'));
    } catch {
      toast.error(t('plan.failed'));
    } finally {
      setHere(false);
    }
  };

  return (
    <>
      <View
        testID="meeting-screen"
        style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {place === undefined ? null : (
          <View style={styles.map} pointerEvents="none">
            <BarguMap
              overlay
              insets={{}}
              focus={[place.lng, place.lat]}
              focusZoom={MINI_MAP_ZOOM}
            />
            {/* The map is centred on the place: the flag's foot stands on the centre (an empty
                space as tall as the flag under it keeps the foot there). */}
            <View style={styles.pinSpot}>
              <View style={[styles.pin, { backgroundColor: colors.accent }]}>
                <Flag color={colors.onAccent} size={18} strokeWidth={2.5} />
              </View>
              <View style={[styles.stem, { backgroundColor: colors.accent }]} />
              <View style={styles.pinRoom} />
            </View>
            <Text variant="caption" color="textMuted" style={styles.credit}>
              {t('main.mapCredit')}
            </Text>
          </View>
        )}
        <View style={styles.heroBody}>
          <View style={styles.where}>
            {place === undefined ? null : (
              <View style={[styles.emoji, { backgroundColor: colors.primarySoft }]}>
                <Text variant="title2" allowFontScaling={false}>
                  {place.emoji}
                </Text>
              </View>
            )}
            <View style={styles.whereText}>
              <Text variant="title2" numberOfLines={2}>
                {place?.name ?? t('plan.noPlace')}
              </Text>
              <Text variant="callout" color="textMuted" testID="meeting-when">
                {when}
              </Text>
            </View>
          </View>
          {starter === undefined && plan?.spot === undefined ? null : (
            <View style={styles.tags}>
              {starter === undefined ? null : (
                <View style={styles.starter}>
                  <Avatar
                    avatar={starter.avatar}
                    name={memberName(starter)}
                    userId={starter.userId}
                    size="sm"
                  />
                  <Text variant="footnote" color="textMuted" testID="meeting-starter">
                    {starter.userId === me
                      ? t('meeting.startedByYou')
                      : t('meeting.startedBy', { name: memberName(starter) })}
                  </Text>
                </View>
              )}
              {plan?.spot !== undefined ? (
                <Badge label={t('meeting.spotOnly')} icon={MapPin} />
              ) : null}
            </View>
          )}
        </View>
      </View>
      <View style={styles.actions}>
        {place === undefined ? null : (
          <ActionTile
            testID="meeting-directions"
            label={t('meeting.directions')}
            icon={Navigation}
            primary
            onPress={() => {
              openDirections(place);
            }}
          />
        )}
        {mayChange ? (
          <ActionTile
            testID="meeting-edit"
            label={t('meeting.edit')}
            icon={Pencil}
            onPress={onEdit}
          />
        ) : null}
        {onTheWay ? (
          <ActionTile
            testID="late-open"
            label={t('plan.late')}
            icon={Hourglass}
            onPress={() => lateSheet.current?.present()}
          />
        ) : null}
        {onTheWay ? (
          <ActionTile
            testID="meeting-here"
            label={t('meeting.here')}
            icon={CircleCheck}
            disabled={here}
            onPress={() => {
              void sayHere();
            }}
          />
        ) : null}
      </View>
      {place === undefined ? null : (
        <Text variant="caption" color="textMuted">
          {t('meeting.directionsHint')}
        </Text>
      )}
      {onTheWay ? (
        <LateSheet
          ref={lateSheet}
          circleId={circle.id}
          onSent={() => lateSheet.current?.dismiss()}
        />
      ) : null}
    </>
  );
}

const LATE_STEPS = ['10', '20', '30', '45'] as const;

/** "Geç kalacağım": how late, then one message to the circle. */
function LateSheet({
  ref,
  circleId,
  onSent,
}: {
  ref: Ref<SheetRef>;
  circleId: string;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [lateBy, setLateBy] = useState<(typeof LATE_STEPS)[number]>('10');
  const [sending, setSending] = useState(false);
  const tell = async () => {
    setSending(true);
    const sent = await meetings.late(circleId, Number(lateBy));
    setSending(false);
    if (sent) {
      toast.success(t('plan.lateSent'));
      onSent();
    } else {
      toast.error(t('plan.failed'));
    }
  };
  return (
    <Sheet ref={ref} title={t('plan.late')} testID="late-sheet">
      <Segmented
        testID="late-by"
        label={t('plan.lateHow')}
        options={LATE_STEPS.map((minutes) => ({
          value: minutes,
          label: t('plan.lateMinutes', { minutes }),
        }))}
        value={lateBy}
        onChange={setLateBy}
      />
      <Button
        testID="late-send"
        label={t('plan.lateSend')}
        loading={sending}
        onPress={() => {
          void tell();
        }}
      />
    </Sheet>
  );
}

/** "Geliyor musun?" (docs/ADR/0026 Ek 2): this user's own answer, one tap. */
export function MeetingAnswerCard({ circle, me }: { circle: Circle; me: string }) {
  const { t } = useTranslation();
  const answers = answersOf(useDocs(), circle.id);
  return (
    <Card title={t('meeting.answers.title')} testID="meeting-answers">
      <Segmented<MeetingAnswer | 'none'>
        testID="meeting-answer"
        label={t('meeting.answers.title')}
        options={MEETING_ANSWERS.map((answer) => ({
          value: answer,
          label: t(`meeting.answers.${answer}`),
        }))}
        value={answers.get(me) ?? 'none'}
        onChange={(answer) => {
          if (answer !== 'none') void answerMeeting(circle.id, answer);
        }}
      />
    </Card>
  );
}

type Tone = 'muted' | 'primary' | 'success' | 'danger';
const ANSWER_TONE: Record<MeetingAnswer, Tone> = {
  going: 'success',
  maybe: 'primary',
  not: 'danger',
};
const ANSWER_ORDER: Record<MeetingAnswer | 'none', number> = {
  going: 0,
  maybe: 1,
  none: 2,
  not: 3,
};

/**
 * "Kimler geliyor": everyone in the circle with what they said, those coming first; from half an
 * hour before its time, who is there or when they get there instead (docs/ADR/0026 §5, Ek 2).
 */
export function MeetingPeopleCard({
  circle,
  meeting,
  me,
  now,
}: {
  circle: Circle;
  meeting: Meeting | null;
  me: string;
  now: number;
}) {
  const { t } = useTranslation();
  const answers = answersOf(useDocs(), circle.id);
  const active = circle.members
    .filter((member) => member.status === 'active')
    .sort(
      (a, b) =>
        ANSWER_ORDER[answers.get(a.userId) ?? 'none'] -
          ANSWER_ORDER[answers.get(b.userId) ?? 'none'] ||
        (a.userId === me ? -1 : b.userId === me ? 1 : 0),
    );
  return (
    <Card title={t('meeting.people.title')} testID="meeting-people">
      <Text variant="callout" color="textMuted" testID="meeting-answer-counts">
        {t('meeting.answers.counts', answerCounts(answers))}
      </Text>
      {meeting !== null && inEtaWindow(meeting.meetAt, now) ? (
        <ArrivalRows circle={circle} meeting={meeting} me={me} now={now} answers={answers} />
      ) : (
        active.map((member) => {
          const answer = answers.get(member.userId);
          const name = member.userId === me ? t('plan.you') : memberName(member);
          return (
            <ListRow
              key={member.userId}
              testID={`meeting-answer-${member.userId}`}
              leading={
                <Avatar avatar={member.avatar} name={name} userId={member.userId} size="sm" />
              }
              title={name}
              trailing={
                <Badge
                  label={t(`meeting.people.${answer ?? 'none'}`)}
                  tone={answer === undefined ? 'muted' : ANSWER_TONE[answer]}
                />
              }
            />
          );
        })
      )}
    </Card>
  );
}

/** Who is there, and when the others coming get there (their phones' own estimates). */
function ArrivalRows({
  circle,
  meeting,
  me,
  now,
  answers,
}: {
  circle: Circle;
  meeting: Meeting;
  me: string;
  now: number;
  answers: ReadonlyMap<string, MeetingAnswer>;
}) {
  const { t, i18n } = useTranslation();
  const rows = useArrivals(circle, meeting, me, now);
  const label = (row: Arrival): { text: string; tone: Tone } => {
    if (row.state === 'there') return { text: t('plan.there'), tone: 'success' };
    if (row.state === 'unknown') return { text: t('plan.unknown'), tone: 'muted' };
    const time = endClock(row.at, now, i18n.language);
    return row.late > 0
      ? { text: t('plan.etaLate', { time, minutes: row.late }), tone: 'danger' }
      : { text: t('plan.eta', { time }), tone: 'primary' };
  };
  const counted = new Set(rows.map((row) => row.userId));
  // Those not on the way: what they said, under the board.
  const others = circle.members.filter(
    (member) => member.status === 'active' && !counted.has(member.userId),
  );
  return (
    <View testID="arrivals-board" style={styles.rows}>
      {rows.map((row) => {
        const member = circle.members.find((candidate) => candidate.userId === row.userId);
        if (member === undefined) return null;
        const name = row.userId === me ? t('plan.you') : memberName(member);
        const shown = label(row);
        return (
          <ListRow
            key={row.userId}
            testID={`arrival-${row.userId}`}
            leading={<Avatar avatar={member.avatar} name={name} userId={member.userId} size="sm" />}
            title={name}
            trailing={<Badge label={shown.text} tone={shown.tone} />}
          />
        );
      })}
      {others.map((member) => {
        const answer = answers.get(member.userId);
        const name = member.userId === me ? t('plan.you') : memberName(member);
        return (
          <ListRow
            key={member.userId}
            testID={`meeting-answer-${member.userId}`}
            leading={<Avatar avatar={member.avatar} name={name} userId={member.userId} size="sm" />}
            title={name}
            trailing={
              <Badge
                label={t(`meeting.people.${answer ?? 'none'}`)}
                tone={answer === undefined ? 'muted' : ANSWER_TONE[answer]}
              />
            }
          />
        );
      })}
      <Text variant="caption" color="textMuted">
        {t('plan.boardHint')}
      </Text>
    </View>
  );
}

type ModeChoice = TravelMode | 'auto';

/** "Yolculuğun": how this phone travels there, and a reminder to leave. */
export function MeetingWayCard({ circleId }: { circleId: string }) {
  const { t } = useTranslation();
  meetings.choices();
  const choice = useMeetingChoices((state) => state[circleId]);
  return (
    <Card title={t('meeting.way')} testID="meeting-way">
      <Segmented<ModeChoice>
        testID="meeting-mode"
        label={t('plan.mode')}
        options={[
          { value: 'auto', label: t('plan.modeAuto') },
          { value: 'walk', label: t('plan.modeWalk') },
          { value: 'bike', label: t('plan.modeBike') },
          { value: 'vehicle', label: t('plan.modeVehicle') },
        ]}
        value={choice?.mode ?? 'auto'}
        onChange={(value) => {
          meetings.setMode(circleId, value === 'auto' ? undefined : value);
        }}
      />
      <Toggle
        testID="meeting-remind"
        label={t('plan.remind')}
        description={t('plan.remindHint')}
        value={choice?.remind !== false}
        onChange={(on) => {
          meetings.setRemind(circleId, on);
        }}
      />
    </Card>
  );
}

/**
 * For whoever may change it: end it now. A spot picked for it goes with it; "Bitir, yeri sakla"
 * keeps it as a saved place of the circle, by their own choice (docs/ADR/0026 Ek 1).
 */
export function MeetingManageCard({ circle }: { circle: Circle }) {
  const { t } = useTranslation();
  const plan = useDocs()[docKey(circle.id, circle.id)]?.payload;
  const spot = plan?.kind === 'plan' ? plan.spot : undefined;
  const [ending, setEnding] = useState(false);
  const finish = (keepSpot: boolean) => {
    setEnding(true);
    void endMeeting(circle.id, keepSpot).finally(() => {
      setEnding(false);
    });
  };
  const end = () => {
    Alert.alert(
      t('meeting.endTitle'),
      spot !== undefined ? t('meeting.endBodyPlace') : t('meeting.endBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        ...(spot !== undefined
          ? [
              {
                text: t('meeting.endKeepPlace'),
                onPress: () => {
                  finish(true);
                },
              },
            ]
          : []),
        {
          text: t('meeting.end'),
          style: 'destructive' as const,
          onPress: () => {
            finish(false);
          },
        },
      ],
    );
  };
  return (
    <Card testID="meeting-manage">
      <Button
        testID="meeting-end"
        label={t('meeting.end')}
        icon={Square}
        variant="secondary"
        loading={ending}
        onPress={end}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
  },
  map: { height: 150 },
  pinSpot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pin: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stem: { width: space.xxs, height: space.sm },
  pinRoom: { height: space.xxl + space.sm },
  credit: { position: 'absolute', left: space.sm, bottom: space.xxs },
  heroBody: { padding: space.lg, gap: space.md },
  where: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  emoji: {
    width: space.xxxl,
    height: space.xxxl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whereText: { flex: 1, gap: space.xxs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  starter: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  actions: { flexDirection: 'row', gap: space.sm },
  rows: { gap: space.xs },
});

import type { Circle, LocPayload, PollPayload } from '@bargu/schemas';
import { Check, Circle as Dot, Clock, Hourglass, MapPin, Trash2, Vote } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { SectionTitle } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import type { SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

import { endClock } from '../circles/event-ui';
import { memberName } from '../circles/names';
import { useNow } from '../location/clock';
import { useMyFix } from '../location/engine';
import { meetings } from '../location/location-session';
import { useLocations } from '../location/receive';
import type { Place } from '../places/place-model';
import { usePlaces } from '../places/places';
import { docKey, useDocs } from './docs';
import { type Meeting, meetingOf, useLates, useMeetingChoices } from './meeting';
import { PlaceIcon, PlaceSheet, PollSheet, TimeSheet, timeRange } from './meeting-sheets';
import { closePoll, removePoll, setMeeting, vote, votesOf } from './plan-actions';
import {
  type Arrival,
  arrivals,
  type Doc,
  inEtaWindow,
  MEETING,
  tally,
  type TravelMode,
} from './plan-model';

/**
 * An event's meeting on its screen (docs/ADR/0018): when and where, polls on either, who gets
 * there when as the time comes, and this phone's own way there (how it travels, a reminder to
 * leave, "I'll be late"). Everything here is end-to-end encrypted for the event's members.
 */
export function MeetingCard({ circle }: { circle: Circle }) {
  const { t, i18n } = useTranslation();
  const me = useAuth((state) => state.userId);
  const docs = useDocs();
  const places = usePlaces();
  const now = useNow();
  const timeSheet = useRef<SheetRef>(null);
  const placeSheet = useRef<SheetRef>(null);
  const pollSheet = useRef<SheetRef>(null);
  const [draft, setDraft] = useState(0);
  const [saving, setSaving] = useState(false);
  if (me === null) return null;

  const plan = docs[docKey(circle.id, circle.id)]?.payload;
  const meetAt = plan?.kind === 'plan' ? plan.meetAt : undefined;
  const placeId = plan?.kind === 'plan' ? plan.placeId : undefined;
  const place = placeId === undefined ? undefined : places[placeId];
  const meeting = meetingOf(circle.id, docs, places);
  const polls = Object.values(docs)
    .filter(
      (doc): doc is Doc<PollPayload> => doc.circleId === circle.id && doc.payload.kind === 'poll',
    )
    .sort((a, b) => a.payload.ts - b.payload.ts);
  const range = timeRange(circle, now);

  const openTime = () => {
    setDraft(
      meetAt !== undefined && range !== null ? Math.max(range.min, meetAt) : (range?.min ?? now),
    );
    timeSheet.current?.present();
  };
  const saveTime = async () => {
    setSaving(true);
    const saved = await setMeeting(circle.id, {
      meetAt: draft,
      ...(placeId === undefined ? {} : { placeId }),
    });
    setSaving(false);
    if (saved) timeSheet.current?.dismiss();
  };
  const pickPlace = async (id: string) => {
    placeSheet.current?.dismiss();
    await setMeeting(circle.id, { placeId: id, ...(meetAt === undefined ? {} : { meetAt }) });
  };

  return (
    <View style={styles.card} testID="meeting-card">
      <SectionTitle>{t('plan.title')}</SectionTitle>
      <ListRow
        testID="meeting-time"
        leading={<RoundIcon icon={Clock} />}
        title={meetAt === undefined ? t('plan.noTime') : endClock(meetAt, now, i18n.language)}
        subtitle={meetAt === undefined ? t('plan.chooseTime') : t('plan.time')}
        onPress={openTime}
      />
      <ListRow
        testID="meeting-place"
        leading={
          place === undefined ? <RoundIcon icon={MapPin} /> : <PlaceIcon emoji={place.emoji} />
        }
        title={place === undefined ? t('plan.noPlace') : place.name}
        subtitle={place === undefined ? t('plan.choosePlace') : t('plan.place')}
        onPress={() => placeSheet.current?.present()}
      />

      {polls.map((poll) => (
        <PollCard key={poll.payload.id} circle={circle} poll={poll.payload} me={me} />
      ))}
      <Button
        testID="poll-start"
        label={t('plan.pollStart')}
        icon={Vote}
        variant="secondary"
        onPress={() => pollSheet.current?.present()}
      />

      {meeting !== null && inEtaWindow(meeting.meetAt, now) ? (
        <ArrivalsBoard circle={circle} meeting={meeting} me={me} now={now} />
      ) : null}
      {meeting !== null && now <= meeting.meetAt + MEETING.etaUntilMs ? (
        <MyWay circleId={circle.id} />
      ) : null}

      <TimeSheet
        ref={timeSheet}
        range={range}
        value={draft}
        onChange={setDraft}
        saving={saving}
        onSave={() => {
          void saveTime();
        }}
      />
      <PlaceSheet
        ref={placeSheet}
        circleId={circle.id}
        chosen={placeId}
        onPick={(id) => {
          void pickPlace(id);
        }}
      />
      <PollSheet
        ref={pollSheet}
        circle={circle}
        me={me}
        range={range}
        onDone={() => pollSheet.current?.dismiss()}
      />
    </View>
  );
}

function RoundIcon({ icon: Icon }: { icon: typeof Clock }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.round, { backgroundColor: colors.primarySoft }]}>
      <Icon size={20} color={colors.primary} strokeWidth={2.25} />
    </View>
  );
}

/** A poll: its options with their votes, a tap to vote, and its end for whoever may end it. */
function PollCard({ circle, poll, me }: { circle: Circle; poll: PollPayload; me: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const docs = useDocs();
  const places = usePlaces();
  const now = useNow();
  const members = new Set(
    circle.members.filter((member) => member.status === 'active').map((member) => member.userId),
  );
  const votes = votesOf(docs, circle.id);
  const result = tally(poll, votes, members);
  const mine = votes.find((doc) => doc.authorId === me && doc.payload.pollId === poll.id);
  const chosen = new Set(mine?.payload.choices ?? []);
  const may = poll.by === me || circle.myRole === 'owner';
  const starter = circle.members.find((member) => member.userId === poll.by);
  const closed = poll.closed?.choice;
  const label = (index: number): string => {
    const option = poll.options[index];
    if (option === undefined) return '';
    if ('at' in option) return endClock(option.at, now, i18n.language);
    const place: Place | undefined = places[option.placeId];
    return place === undefined
      ? `${option.name} ${t('plan.pollGone')}`
      : `${place.emoji} ${place.name}`;
  };

  const toggle = (index: number) => {
    const next = new Set(chosen);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    void vote(
      circle.id,
      poll.id,
      me,
      [...next].sort((a, b) => a - b),
    );
  };
  const end = () => {
    Alert.alert(t('plan.pollCloseTitle'), t('plan.pollCloseBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plan.pollClose'),
        onPress: () => {
          void closePoll(circle.id, poll, members);
        },
      },
    ]);
  };

  return (
    <View
      style={[styles.poll, { backgroundColor: colors.surfaceRaised }]}
      testID={`poll-${poll.id}`}
    >
      <Text variant="bodyStrong">
        {poll.about === 'time' ? t('plan.pollTime') : t('plan.pollPlace')}
      </Text>
      <Text variant="footnote" color="textMuted">
        {closed === undefined
          ? [
              starter === undefined ? null : t('plan.pollBy', { name: memberName(starter) }),
              t('plan.pollHint'),
            ]
              .filter((part) => part !== null)
              .join(' · ')
          : t('plan.pollResult', { option: label(closed) })}
      </Text>
      {poll.options.map((_, index) => {
        const count = result.counts[index] ?? 0;
        const on = chosen.has(index);
        const winner = closed === index;
        const share = members.size === 0 ? 0 : count / members.size;
        return (
          <PressableScale
            key={index}
            testID={`poll-${poll.id}-option-${String(index)}`}
            haptic="select"
            disabled={closed !== undefined}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: closed !== undefined }}
            accessibilityLabel={`${label(index)}, ${t('plan.pollVotes', { count })}`}
            onPress={() => {
              toggle(index);
            }}
            style={[styles.option, { backgroundColor: colors.surface }]}
          >
            {/* The share of members fine with it, as a bar behind the option. */}
            <View style={[StyleSheet.absoluteFill, styles.track]} pointerEvents="none">
              <View style={{ flex: share, backgroundColor: colors.primarySoft }} />
              <View style={{ flex: 1 - share }} />
            </View>
            {(closed === undefined ? on : winner) ? (
              <Check size={18} color={colors.primary} strokeWidth={3} />
            ) : (
              <Dot size={18} color={colors.textMuted} />
            )}
            <Text
              variant={winner ? 'bodyStrong' : 'callout'}
              style={styles.optionText}
              numberOfLines={1}
            >
              {label(index)}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('plan.pollVotes', { count })}
            </Text>
          </PressableScale>
        );
      })}
      {may && closed === undefined && result.leader !== null ? (
        <Button
          testID={`poll-${poll.id}-close`}
          label={t('plan.pollClose')}
          variant="secondary"
          onPress={end}
        />
      ) : null}
      {may && closed !== undefined ? (
        <Button
          testID={`poll-${poll.id}-delete`}
          label={t('plan.pollDelete')}
          icon={Trash2}
          variant="ghost"
          onPress={() => {
            void removePoll(circle.id, poll.id);
          }}
        />
      ) : null}
    </View>
  );
}

/** "Kim ne zaman orada?": everyone's arrival, as their own phones estimate it. */
function ArrivalsBoard({
  circle,
  meeting,
  me,
  now,
}: {
  circle: Circle;
  meeting: Meeting;
  me: string;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const locations = useLocations();
  const lates = useLates();
  const myFix = useMyFix((state) => state.fix);
  const active = circle.members.filter((member) => member.status === 'active');
  const located: Record<string, LocPayload | undefined> = {};
  const told: Record<string, number | undefined> = {};
  for (const member of active) {
    located[member.userId] = locations[`${circle.id}:${member.userId}`]?.loc;
    const late = lates[`${circle.id}:${member.userId}`];
    if (late?.meetAt === meeting.meetAt) told[member.userId] = late.minutes;
  }
  if (myFix !== null) {
    const eta = meetings.eta(circle.id, myFix, now);
    located[me] = {
      kind: 'loc',
      lat: myFix.lat,
      lng: myFix.lng,
      acc: myFix.acc,
      bat: 100,
      chg: false,
      ts: myFix.ts,
      ...(eta === undefined ? {} : { eta }),
    };
  }
  const rows = arrivals({
    meetAt: meeting.meetAt,
    place: meeting.place,
    members: active.map((member) => member.userId),
    locations: located,
    told,
    now,
  });
  const text = (row: Arrival): string => {
    if (row.state === 'there') return t('plan.there');
    if (row.state === 'unknown') return t('plan.unknown');
    const time = endClock(row.at, now, i18n.language);
    return row.late > 0 ? t('plan.etaLate', { time, minutes: row.late }) : t('plan.eta', { time });
  };

  return (
    <View style={styles.board} testID="arrivals-board">
      <Text variant="headline">{t('plan.board')}</Text>
      {rows.map((row) => {
        const member = active.find((candidate) => candidate.userId === row.userId);
        if (member === undefined) return null;
        const name = row.userId === me ? t('plan.you') : memberName(member);
        return (
          <ListRow
            key={row.userId}
            testID={`arrival-${row.userId}`}
            leading={<Avatar avatar={member.avatar} name={name} userId={member.userId} size="sm" />}
            title={name}
            trailing={
              <Text
                variant="subhead"
                style={{
                  color:
                    row.state === 'there'
                      ? colors.success
                      : row.state === 'coming' && row.late > 0
                        ? colors.danger
                        : colors.textMuted,
                }}
              >
                {text(row)}
              </Text>
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

const LATE_STEPS = ['10', '20', '30', '45'] as const;
type ModeChoice = TravelMode | 'auto';

/** This phone's way to the meeting: how it travels, a reminder to leave, "I'll be late". */
function MyWay({ circleId }: { circleId: string }) {
  const { t } = useTranslation();
  meetings.choices();
  const choice = useMeetingChoices((state) => state[circleId]);
  const [lateOpen, setLateOpen] = useState(false);
  const [lateBy, setLateBy] = useState<(typeof LATE_STEPS)[number]>('10');
  const [sending, setSending] = useState(false);

  const tell = async () => {
    setSending(true);
    const sent = await meetings.late(circleId, Number(lateBy));
    setSending(false);
    if (sent) {
      toast.success(t('plan.lateSent'));
      setLateOpen(false);
    } else {
      toast.error(t('plan.failed'));
    }
  };

  return (
    <View style={styles.mine}>
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
      {lateOpen ? (
        <>
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
        </>
      ) : (
        <Button
          testID="late-open"
          label={t('plan.late')}
          icon={Hourglass}
          variant="secondary"
          onPress={() => {
            setLateOpen(true);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  round: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poll: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: space.xxxl,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  track: { flexDirection: 'row' },
  optionText: { flex: 1 },
  board: { gap: space.xs },
  mine: { gap: space.md },
});

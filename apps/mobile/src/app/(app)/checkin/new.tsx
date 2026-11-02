import { CHECKIN } from '@bargu/schemas';
import { router } from 'expo-router';
import { Check, House } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import type { CheckPlace, Grace } from '@/features/checkin/checkin-model';
import { type CheckinResult, startCheck, startPlan } from '@/features/checkin/checkin-session';
import { Emergency } from '@/features/checkin/emergency';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import { clockOf } from '@/features/location/person-share';
import { useLocationPermission } from '@/features/location/tracker';
import { usePlaces } from '@/features/places/places';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Hint } from '@/ui/hint';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { StepSlider } from '@/ui/step-slider';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

const HALF_HOUR_MS = 30 * 60_000;
/** Due times offered: every half hour for twelve hours, the first at least 15 minutes away. */
function dueChoices(now: number): number[] {
  const first = Math.ceil((now + HALF_HOUR_MS / 2) / HALF_HOUR_MS) * HALF_HOUR_MS;
  return Array.from({ length: 24 }, (_, index) => first + index * HALF_HOUR_MS);
}
const WEEKDAYS = [1, 2, 3, 4, 5];
/** "23:30" on this phone's clock: what a repeated plan keeps. */
function hourOf(at: number): string {
  const time = new Date(at);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(time.getHours())}:${two(time.getMinutes())}`;
}

/**
 * A new arrival check (docs/ADR/0039 §1): where (a saved place, or none and "Vardım" by hand), by
 * when, how much extra time, who to tell (people in a circle with the user), a note, and whether
 * it repeats on weekdays. The summary says what happens, and that Bargu is no emergency service.
 */
export default function NewCheckScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const me = useAuth((state) => state.userId);
  const circleData = useCircles().data;
  const circles = useMemo(() => circleData ?? [], [circleData]);
  const places = usePlaces();
  const now = useNow();
  const choices = useMemo(() => dueChoices(now), [now]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [due, setDue] = useState<number>(choices[1] ?? choices[0] ?? now);
  const [grace, setGrace] = useState<Grace>(10);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const located = useLocationPermission(
    (state) => state.state !== 'blocked' && state.state !== 'undetermined',
  );

  // Everyone in a circle with the user, once; the ones whose app can be reached (a device).
  const people = useMemo(() => {
    const seen = new Map<string, (typeof circles)[number]['members'][number]>();
    for (const circle of circles) {
      if (circle.myStatus !== 'active') continue;
      for (const member of circle.members) {
        if (member.userId === me || member.status !== 'active' || member.device === null) continue;
        if (!seen.has(member.userId)) seen.set(member.userId, member);
      }
    }
    return [...seen.values()];
  }, [circles, me]);
  const placeList = Object.entries(places);
  const picked = placeId === null ? undefined : places[placeId];
  const place: CheckPlace | null =
    picked === undefined
      ? null
      : {
          name: picked.name,
          emoji: picked.emoji,
          lat: picked.lat,
          lng: picked.lng,
          radius: picked.radius,
        };
  const names = chosen
    .map((userId) => people.find((person) => person.userId === userId))
    .flatMap((person) => (person === undefined ? [] : [memberName(person)]))
    .join(', ');

  const toggle = (userId: string) => {
    setChosen((current) =>
      current.includes(userId)
        ? current.filter((each) => each !== userId)
        : current.length >= CHECKIN.maxRecipients
          ? current
          : [...current, userId],
    );
  };

  const start = async () => {
    if (chosen.length === 0) {
      toast.error(t('checkin.noRecipients'));
      return;
    }
    setBusy(true);
    const words = note.trim();
    const common = {
      grace,
      place,
      recipients: chosen,
      ...(words === '' ? {} : { note: words }),
    };
    const result: CheckinResult = repeat
      ? await startPlan({ ...common, days: WEEKDAYS, at: hourOf(due) })
      : await startCheck({ ...common, due });
    setBusy(false);
    if (result === 'ok') {
      // Without location the phone cannot tell it arrived: "Vardım" by hand (QA-44 Orta 2).
      toast.success(t(located ? 'checkin.started' : 'checkin.startedNoLocation'));
      router.back();
      return;
    }
    toast.error(
      t(
        result === 'TIME' ||
          result === 'TOO_MANY' ||
          result === 'DAILY_LIMIT' ||
          result === 'RECIPIENT'
          ? `checkin.refused.${result}`
          : 'checkin.refused.failed',
      ),
    );
  };

  return (
    <Screen
      title={t('checkin.title')}
      testID="checkin-new-screen"
      footer={
        <Button
          testID="checkin-start"
          label={t('checkin.start')}
          icon={House}
          loading={busy}
          disabled={chosen.length === 0}
          onPress={() => void start()}
        />
      }
    >
      <Card title={t('checkin.where')}>
        <View style={styles.chips}>
          {[null, ...placeList.map(([id]) => id)].map((id) => {
            const each = id === null ? undefined : places[id];
            const selected = placeId === id;
            return (
              <PressableScale
                key={id ?? 'none'}
                testID={`checkin-place-${id ?? 'none'}`}
                haptic="select"
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setPlaceId(id);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? colors.primarySoft : colors.surfaceRaised,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text variant="subhead" color={selected ? 'primary' : 'text'}>
                  {each === undefined ? t('checkin.noPlace') : `${each.emoji} ${each.name}`}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </Card>
      <StepSlider
        testID="checkin-due"
        label={t('checkin.due')}
        steps={choices.map((at) => ({ value: String(at), label: clockOf(at, i18n.language) }))}
        value={String(due)}
        onChange={(value) => {
          setDue(Number(value));
        }}
      />
      <Segmented
        testID="checkin-grace"
        label={t('checkin.grace')}
        options={CHECKIN.graceMinutes.map((minutes) => ({
          value: String(minutes),
          label: t('checkin.graceOption', { count: minutes }),
        }))}
        value={String(grace)}
        onChange={(value) => {
          setGrace(Number(value) as Grace);
        }}
      />
      <Card title={t('checkin.who')}>
        <Text variant="footnote" color="textMuted">
          {t('checkin.whoHint')}
        </Text>
        {people.map((person) => {
          const selected = chosen.includes(person.userId);
          return (
            <ListRow
              key={person.userId}
              testID={`checkin-person-${person.userId}`}
              leading={
                <Avatar
                  avatar={person.avatar}
                  name={memberName(person)}
                  userId={person.userId}
                  size="sm"
                />
              }
              title={memberName(person)}
              trailing={
                selected ? <Check color={colors.primary} size={22} strokeWidth={2.5} /> : undefined
              }
              accessibilityLabel={selected ? `${memberName(person)} ✓` : memberName(person)}
              onPress={() => {
                toggle(person.userId);
              }}
            />
          );
        })}
      </Card>
      <TextField
        testID="checkin-note"
        label={t('checkin.note')}
        placeholder={t('checkin.notePlaceholder')}
        value={note}
        maxLength={CHECKIN.noteMax}
        onChangeText={setNote}
      />
      <Toggle
        testID="checkin-repeat"
        label={t('checkin.repeat')}
        description={t('checkin.needsPhone')}
        value={repeat}
        onChange={setRepeat}
      />
      {chosen.length === 0 ? null : (
        <Text variant="body" testID="checkin-summary">
          {t('checkin.summary', { time: clockOf(due, i18n.language), names })}
        </Text>
      )}
      {located ? null : <Hint testID="checkin-no-location">{t('checkin.noPermission')}</Hint>}
      <Emergency />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
});

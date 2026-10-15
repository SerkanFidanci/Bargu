import { MAX_POLL_OPTIONS, type Circle, type PollPayload } from '@bargu/schemas';
import { router } from 'expo-router';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  X,
} from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { Segmented } from '@/ui/segmented';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';

import { endClock } from '../circles/event-ui';
import { useNow } from '../location/clock';
import type { Place } from '../places/place-model';
import { usePlaces } from '../places/places';
import { startPoll } from './plan-actions';
import { MEETING, meetingTimes } from './plan-model';

const HOUR = 60 * 60_000;

/** The places of an event, by name. */
export function useEventPlaces(circleId: string): Place[] {
  return Object.values(usePlaces())
    .filter((place) => place.circleId === circleId)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** The meeting times this event allows: a quarter of an hour from now to its end. */
export function timeRange(circle: Circle, now: number): { min: number; max: number } | null {
  const times = meetingTimes(now, circle.expiresAt ?? now);
  const min = times[0];
  const max = times.at(-1);
  return min === undefined || max === undefined ? null : { min, max };
}

/** A time picked in quarter hours: an hour or a quarter earlier or later, within the event. */
function TimeStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (at: number) => void;
  min: number;
  max: number;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const step = (delta: number) => {
    onChange(Math.min(max, Math.max(min, value + delta)));
  };
  return (
    <View style={[styles.stepper, { backgroundColor: colors.surface }]} testID="time-stepper">
      <IconButton
        icon={ChevronsLeft}
        tone="plain"
        label={t('plan.earlier', { minutes: 60 })}
        onPress={() => {
          step(-HOUR);
        }}
      />
      <IconButton
        icon={ChevronLeft}
        tone="plain"
        label={t('plan.earlier', { minutes: 15 })}
        onPress={() => {
          step(-MEETING.stepMs);
        }}
      />
      <Text variant="title2" align="center" style={styles.time} accessibilityLiveRegion="polite">
        {endClock(value, now, i18n.language)}
      </Text>
      <IconButton
        icon={ChevronRight}
        tone="plain"
        label={t('plan.later', { minutes: 15 })}
        onPress={() => {
          step(MEETING.stepMs);
        }}
      />
      <IconButton
        icon={ChevronsRight}
        tone="plain"
        label={t('plan.later', { minutes: 60 })}
        onPress={() => {
          step(HOUR);
        }}
      />
    </View>
  );
}

/** The meeting's time: picked here, saved for everyone in the event. */
export const TimeSheet = forwardRef<
  SheetRef,
  {
    range: { min: number; max: number } | null;
    value: number;
    onChange: (at: number) => void;
    onSave: () => void;
    saving: boolean;
  }
>(function TimeSheet({ range, value, onChange, onSave, saving }, ref) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t('plan.timeTitle')} testID="time-sheet">
      {range === null ? null : (
        <TimeStepper value={value} onChange={onChange} min={range.min} max={range.max} />
      )}
      <Button
        testID="time-save"
        label={t('plan.save')}
        onPress={onSave}
        loading={saving}
        disabled={range === null}
      />
    </Sheet>
  );
});

/** The meeting's place: one of the event's places, or a new one. */
export const PlaceSheet = forwardRef<
  SheetRef,
  { circleId: string; chosen: string | undefined; onPick: (placeId: string) => void }
>(function PlaceSheet({ circleId, chosen, onPick }, ref) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const places = useEventPlaces(circleId);
  return (
    <Sheet ref={ref} title={t('plan.placeTitle')} testID="place-sheet">
      {places.length === 0 ? (
        <Text variant="body" color="textMuted">
          {t('plan.noPlaces')}
        </Text>
      ) : (
        places.map((place) => (
          <ListRow
            key={place.id}
            testID={`meeting-place-${place.id}`}
            leading={<PlaceIcon emoji={place.emoji} />}
            title={place.name}
            subtitle={t('places.meters', { meters: place.radius })}
            trailing={place.id === chosen ? <Check size={20} color={colors.primary} /> : null}
            onPress={() => {
              onPick(place.id);
            }}
          />
        ))
      )}
      <Button
        testID="meeting-add-place"
        label={t('plan.addPlace')}
        icon={Plus}
        variant="secondary"
        onPress={() => {
          router.push({ pathname: '/place/[circleId]', params: { circleId } });
        }}
      />
    </Sheet>
  );
});

export function PlaceIcon({ emoji }: { emoji: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.icon, { backgroundColor: colors.surface }]}>
      <Text variant="headline" allowFontScaling={false}>
        {emoji}
      </Text>
    </View>
  );
}

/** A new poll on the meeting's time or place, with two to four options. */
export const PollSheet = forwardRef<
  SheetRef,
  { circle: Circle; me: string; range: { min: number; max: number } | null; onDone: () => void }
>(function PollSheet({ circle, me, range, onDone }, ref) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const places = useEventPlaces(circle.id);
  const [about, setAbout] = useState<PollPayload['about']>('time');
  const [times, setTimes] = useState<number[]>([]);
  const [draft, setDraft] = useState<number | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const picked = draft ?? range?.min ?? now;

  const reset = () => {
    setTimes([]);
    setChosen([]);
    setDraft(null);
  };
  const options: PollPayload['options'] =
    about === 'time'
      ? [...times].sort((a, b) => a - b).map((at) => ({ at }))
      : places
          .filter((place) => chosen.includes(place.id))
          .map((place) => ({ placeId: place.id, name: place.name }));
  const ready = options.length >= 2 && options.length <= MAX_POLL_OPTIONS;

  const create = async () => {
    setSaving(true);
    const started = await startPoll(circle.id, me, about, options);
    setSaving(false);
    if (started) {
      reset();
      onDone();
    }
  };

  return (
    <Sheet ref={ref} title={t('plan.pollStart')} onDismiss={reset} testID="poll-sheet">
      <Segmented
        testID="poll-about"
        label={t('plan.pollAbout')}
        options={[
          { value: 'time', label: t('plan.pollAboutTime') },
          { value: 'place', label: t('plan.pollAboutPlace') },
        ]}
        value={about}
        onChange={setAbout}
      />
      <Text variant="subhead" color="textMuted">
        {t('plan.pollOptions')}
      </Text>
      {about === 'time' ? (
        <>
          {[...times]
            .sort((a, b) => a - b)
            .map((at) => {
              const label = endClock(at, now, i18n.language);
              return (
                <ListRow
                  key={at}
                  leading={<PlaceIcon emoji="🕒" />}
                  title={label}
                  trailing={
                    <IconButton
                      icon={X}
                      tone="plain"
                      label={t('plan.pollRemove', { option: label })}
                      onPress={() => {
                        setTimes(times.filter((time) => time !== at));
                      }}
                    />
                  }
                />
              );
            })}
          {range === null || times.length >= MAX_POLL_OPTIONS ? null : (
            <>
              <TimeStepper value={picked} onChange={setDraft} min={range.min} max={range.max} />
              <Button
                testID="poll-add-time"
                label={t('plan.pollAdd')}
                icon={Plus}
                variant="secondary"
                disabled={times.includes(picked)}
                onPress={() => {
                  setTimes([...times, picked]);
                  setDraft(Math.min(range.max, picked + HOUR));
                }}
              />
            </>
          )}
        </>
      ) : places.length < 2 ? (
        <Text variant="body" color="textMuted">
          {t('plan.noPlaces')}
        </Text>
      ) : (
        places.map((place) => {
          const on = chosen.includes(place.id);
          return (
            <ListRow
              key={place.id}
              leading={<PlaceIcon emoji={place.emoji} />}
              title={place.name}
              trailing={on ? <Check size={20} color={colors.primary} /> : null}
              onPress={() => {
                if (on) setChosen(chosen.filter((id) => id !== place.id));
                else if (chosen.length < MAX_POLL_OPTIONS) setChosen([...chosen, place.id]);
              }}
            />
          );
        })
      )}
      <Button
        testID="poll-create"
        label={t('plan.pollCreate')}
        disabled={!ready}
        loading={saving}
        onPress={() => {
          void create();
        }}
      />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    paddingHorizontal: space.xs,
  },
  time: { flex: 1 },
  icon: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

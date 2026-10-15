import {
  DAILY_LIMIT_MINUTES,
  type GuardianRequest,
  type GuardianSettings,
  type GuardianView,
} from '@bargu/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { SectionTitle } from '@/ui/screen';
import { StepSlider } from '@/ui/step-slider';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

import { errorMessage, isApiError } from '../errors';
import { guardiansApi, guardiansKey, guardianViewKey } from './guardians-api';
import { localDay } from './screen-time';

/** The daily limits a parent can choose, in minutes; "off" for none. */
const LIMITS = ['off', '30', '60', '90', '120', '180', '240', '360'] as const;
type Limit = (typeof LIMITS)[number];

const toLimit = (minutes: number | null): Limit => {
  const chosen = LIMITS.find((step) => step === String(minutes));
  return minutes === null || chosen === undefined ? 'off' : chosen;
};
const fromLimit = (limit: Limit): number | null => {
  if (limit === 'off') return null;
  const minutes = Number(limit);
  return minutes >= DAILY_LIMIT_MINUTES.min && minutes <= DAILY_LIMIT_MINUTES.max ? minutes : null;
};

/**
 * The guardian tools on the shared view (docs/ADR/0023 §5): minutes the app was open, what waits
 * for a parent's yes, and the settings. The parent changes and answers; the child sees the same,
 * with who changed what and when.
 */
export function GuardianTools({ view }: { view: GuardianView }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const parent = view.link.role === 'guardian';
  const linkId = view.link.id;

  const save = useMutation({
    mutationFn: (settings: GuardianSettings) => guardiansApi.setSettings(linkId, settings),
    onSuccess: (next) => {
      queryClient.setQueryData(guardianViewKey(linkId), next);
      toast.success(t('guardians.tools.saved'));
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });
  const answer = useMutation({
    mutationFn: ({ request, yes }: { request: GuardianRequest; yes: boolean }) =>
      guardiansApi.answer(linkId, request.id, yes),
    onSuccess: (_, { yes }) => {
      toast.success(yes ? t('guardians.tools.approved') : t('guardians.tools.declined'));
      void queryClient.invalidateQueries({ queryKey: guardiansKey });
    },
    onError: (error) => {
      toast.error(
        isApiError(error, 'REQUEST_FAILED')
          ? t('guardians.tools.requestFailed')
          : errorMessage(error, t),
      );
      void queryClient.invalidateQueries({ queryKey: guardiansKey });
    },
  });

  const card = [styles.card, { backgroundColor: colors.surface }];
  // The day the screen opened on: "Bugün" is that day (a re-render does not move it).
  const [today] = useState(() => localDay(Date.now()));
  const dayName = (day: string) =>
    day === today
      ? t('guardians.tools.today')
      : new Date(`${day}T12:00:00`).toLocaleDateString(i18n.language, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        });
  const what = (request: GuardianRequest) => {
    switch (request.kind) {
      case 'friend':
        return t('guardians.tools.askFriend', { name: request.name ?? '' });
      case 'group':
        return t('guardians.tools.askGroup', {
          name: request.name ?? '',
          count: request.memberCount ?? 0,
          by: request.by ?? '',
        });
      case 'event':
        return t('guardians.tools.askEvent', { name: request.name ?? '', by: request.by ?? '' });
      case 'gone':
        return t('guardians.tools.askGone');
    }
  };
  const settings = view.settings;

  return (
    <>
      <SectionTitle>{t('guardians.tools.requestsTitle')}</SectionTitle>
      {view.requests.length === 0 ? (
        <Text variant="callout" color="textMuted">
          {t('guardians.tools.noRequests')}
        </Text>
      ) : (
        view.requests.map((request) => (
          <View key={request.id} style={card}>
            <Text variant="callout">{what(request)}</Text>
            {parent ? (
              <>
                <Button
                  testID={`guardian-approve-${request.id}`}
                  label={t('guardians.tools.approve')}
                  loading={answer.isPending}
                  onPress={() => {
                    answer.mutate({ request, yes: true });
                  }}
                />
                <Button
                  label={t('guardians.tools.decline')}
                  variant="secondary"
                  onPress={() => {
                    answer.mutate({ request, yes: false });
                  }}
                />
              </>
            ) : (
              <Text variant="footnote" color="textMuted">
                {t('guardians.tools.waiting')}
              </Text>
            )}
          </View>
        ))
      )}

      <SectionTitle>{t('guardians.tools.usageTitle')}</SectionTitle>
      <View style={card}>
        {view.usage.length === 0 ? (
          <Text variant="callout" color="textMuted">
            {t('guardians.tools.noUsage')}
          </Text>
        ) : (
          [...view.usage].reverse().map((day) => (
            <View key={day.day} style={styles.row}>
              <Text variant="callout" style={styles.grow}>
                {dayName(day.day)}
              </Text>
              <Text variant="bodyStrong">
                {t('guardians.tools.minutes', { minutes: day.minutes })}
              </Text>
            </View>
          ))
        )}
      </View>

      <SectionTitle>{t('guardians.tools.settingsTitle')}</SectionTitle>
      <View style={card}>
        {parent ? (
          <>
            <Toggle
              testID="guardian-approve-new"
              label={t('guardians.tools.approveNew')}
              description={t('guardians.tools.approveNewHint')}
              value={settings.approveNewPeople}
              disabled={save.isPending}
              onChange={(on) => {
                save.mutate({
                  approveNewPeople: on,
                  dailyLimitMinutes: settings.dailyLimitMinutes,
                });
              }}
            />
            <StepSlider
              testID="guardian-limit"
              label={t('guardians.tools.limit')}
              steps={LIMITS.map((value) => ({
                value,
                label:
                  value === 'off'
                    ? t('guardians.tools.limitOff')
                    : t('guardians.tools.minutes', { minutes: Number(value) }),
              }))}
              value={toLimit(settings.dailyLimitMinutes)}
              onChange={(limit) => {
                save.mutate({
                  approveNewPeople: settings.approveNewPeople,
                  dailyLimitMinutes: fromLimit(limit),
                });
              }}
            />
          </>
        ) : (
          <>
            <Text variant="callout">
              {settings.approveNewPeople
                ? t('guardians.tools.approveNewOn')
                : t('guardians.tools.approveNewOff')}
            </Text>
            <Text variant="callout">
              {settings.dailyLimitMinutes === null
                ? t('guardians.tools.limitNone')
                : t('guardians.tools.limitIs', { minutes: settings.dailyLimitMinutes })}
            </Text>
          </>
        )}
        <Text variant="footnote" color="textMuted">
          {settings.updatedBy === null
            ? t('guardians.tools.defaults')
            : t('guardians.tools.changedBy', {
                name: `@${settings.updatedBy}`,
                date: new Date(settings.updatedAt).toLocaleString(i18n.language),
              })}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
});

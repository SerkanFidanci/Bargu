import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, History, MapPin, Snowflake } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircle } from '@/features/circles/queries';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { SectionTitle } from '@/ui/screen';
import { Hint } from '@/ui/hint';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

import { useNow } from './clock';
import { setHistory, updateSharing } from './location-session';
import { ensureHistoryConsent } from '../account/privacy-gate';
import {
  type CircleSharing,
  circleSharing,
  endOfDay,
  type GhostMode,
  GHOST_MODES,
  PRECISIONS,
  useSharing,
} from './sharing';

const DURATIONS = ['always', 'hour', 'tonight'] as const;
type Duration = (typeof DURATIONS)[number];
const HOUR_MS = 60 * 60_000;

function durationOf(sharing: CircleSharing, now: number): Duration {
  if (sharing.until === null) return 'always';
  return sharing.until === endOfDay(now) ? 'tonight' : 'hour';
}

function untilOf(duration: Duration, now: number): number | null {
  if (duration === 'always') return null;
  return duration === 'hour' ? now + HOUR_MS : endOfDay(now);
}

/** "22:00" in the user's language. */
function clock(at: number, language: string): string {
  return new Date(at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}

/**
 * What one circle sees of the user (BARGU_PLAN §2: every circle separately): whether it gets the
 * location at all, how precisely (coarsened on this phone, before encryption) and until when.
 * Changes apply at once: a coarser choice replaces the finer location the members have.
 */
/**
 * What a circle gets now, in one line (its row on the circle's screen, the owner: settings open on
 * their own screen): hidden by the ghost, off, or the precision and until when.
 */
export function useSharingSummary(circleId: string): string {
  const { t, i18n } = useTranslation();
  const settings = useSharing();
  const sharing = circleSharing(settings, circleId);
  const now = useNow();
  if (settings.ghost !== 'off') {
    return t(
      settings.ghost === 'freeze' ? 'location.ghost.statusFreeze' : 'location.ghost.statusHide',
    );
  }
  if (!sharing.sharing || (sharing.until !== null && sharing.until <= now)) {
    return t('location.sharing.off');
  }
  const precision = t(`location.precision.${sharing.precision}`);
  return sharing.until === null
    ? t('location.sharing.summaryAlways', { precision })
    : t('location.sharing.summaryUntil', {
        precision,
        time: clock(sharing.until, i18n.language),
      });
}

export function SharingCard({ circleId, name }: { circleId: string; name: string | null }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const settings = useSharing();
  const sharing = circleSharing(settings, circleId);
  const now = useNow();
  const on = sharing.sharing && (sharing.until === null || sharing.until > now);
  const ghost = settings.ghost !== 'off';

  const change = (next: Partial<CircleSharing>) => {
    updateSharing((current) => ({
      ...current,
      circles: { ...current.circles, [circleId]: { ...circleSharing(current, circleId), ...next } },
    }));
  };

  const status = ghost
    ? t(settings.ghost === 'freeze' ? 'location.ghost.statusFreeze' : 'location.ghost.statusHide')
    : !on
      ? t('location.sharing.off')
      : sharing.until === null
        ? t('location.sharing.always')
        : t('location.sharing.until', { time: clock(sharing.until, i18n.language) });

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="sharing-card">
      <SectionTitle>{t('location.sharing.title')}</SectionTitle>
      <Toggle
        testID="sharing-toggle"
        label={
          name === null ? t('location.sharing.toggleGroup') : t('location.sharing.toggle', { name })
        }
        description={status}
        value={on}
        onChange={(value) => {
          change(value ? { sharing: true, until: null } : { sharing: false });
        }}
      />
      {on ? (
        <>
          <Segmented
            testID="sharing-precision"
            label={t('location.sharing.precision')}
            value={sharing.precision}
            onChange={(precision) => {
              change({ precision });
              // History needs the exact location (docs/ADR/0019): a coarser one turns it off and
              // deletes it, so the switch, the setting and the server agree (QA Faz 8 G4).
              if (precision !== 'exact' && sharing.history === true) {
                void setHistory(circleId, false).then((result) => {
                  toast.info(
                    result === 'later'
                      ? t('location.sharing.historyOffLater')
                      : t('location.sharing.historyOffCoarse'),
                  );
                });
              }
            }}
            options={PRECISIONS.map((value) => ({
              value,
              label: t(`location.precision.${value}`),
            }))}
          />
          <Text variant="footnote" color="textMuted">
            {t(`location.precision.${sharing.precision}Detail`)}
          </Text>
          <Segmented
            testID="sharing-duration"
            label={t('location.sharing.duration')}
            value={durationOf(sharing, now)}
            onChange={(duration) => {
              change({ until: untilOf(duration, Date.now()) });
            }}
            options={DURATIONS.map((value) => ({
              value,
              label: t(`location.duration.${value}`),
            }))}
          />
          <HistoryControl
            circleId={circleId}
            exact={sharing.precision === 'exact'}
            on={sharing.history === true}
          />
        </>
      ) : null}
    </View>
  );
}

/**
 * Location history for one circle (docs/ADR/0019): off until the user turns it on, only with the
 * exact location, kept two weeks. Shows who can see it; one tap turns it off and deletes what the
 * circle holds on the server.
 */
function HistoryControl({
  circleId,
  exact,
  on,
}: {
  circleId: string;
  exact: boolean;
  on: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useAuth((state) => state.userId);
  const circle = useCircle(circleId);
  const viewers =
    circle?.members.filter((member) => member.userId !== me && member.status === 'active') ?? [];
  const names = viewers.slice(0, 3).map((member) => memberName(member));
  const more = viewers.length - names.length;
  const seenBy =
    viewers.length === 0
      ? t('location.sharing.historyNobody')
      : t('location.sharing.historySeenBy', {
          names: more > 0 ? `${names.join(', ')} +${String(more)}` : names.join(', '),
        });

  const toggle = (value: boolean) => {
    if (value) {
      // Explicit consent first (KVKK, docs/ADR/0022); the consent screen turns it on itself.
      void ensureHistoryConsent(queryClient, circleId).then(
        (given) => {
          if (given) void setHistory(circleId, true);
        },
        () => {
          toast.error(t('consent.offline'));
        },
      );
      return;
    }
    void setHistory(circleId, value).then((result) => {
      if (result === 'off') toast.success(t('location.sharing.historyOff'));
      if (result === 'later') toast.info(t('location.sharing.historyOffLater'));
    });
  };

  return (
    <>
      <Toggle
        testID="history-toggle"
        label={t('location.sharing.history')}
        description={
          !exact
            ? t('location.sharing.historyExactOnly')
            : on
              ? seenBy
              : t('location.sharing.historyDetail')
        }
        value={exact && on}
        disabled={!exact}
        onChange={toggle}
      />
      <View style={styles.historyActions}>
        {me === null ? null : (
          <View style={styles.historyAction}>
            <Button
              testID="history-mine"
              label={t('location.sharing.historyView')}
              icon={History}
              variant="secondary"
              onPress={() => {
                router.push({ pathname: '/history/[userId]', params: { userId: me, circleId } });
              }}
            />
          </View>
        )}
        <View style={styles.historyAction}>
          <Button
            testID="history-viewers"
            label={t('location.sharing.historyViewers')}
            icon={Eye}
            variant="ghost"
            onPress={() => {
              router.push('/history/viewers');
            }}
          />
        </View>
      </View>
    </>
  );
}

// The same drawings as on the map's ghost button and its sheet (the PM, 2026-10-29).
const GHOST_ICONS = { off: MapPin, freeze: Snowflake, hide: EyeOff } as const;

/**
 * Ghost mode for every circle at once (BARGU_PLAN §2): "freeze" leaves the last location where it
 * is, "hide" takes it off everyone's map. Nothing is sent while either is on.
 */
export function GhostControl() {
  const { t } = useTranslation();
  const ghost = useSharing((state) => state.ghost);
  return (
    <View style={styles.ghost}>
      <Segmented<GhostMode>
        testID="ghost-mode"
        label={t('location.ghost.title')}
        value={ghost}
        onChange={(mode) => {
          updateSharing((current) => ({ ...current, ghost: mode }));
        }}
        options={GHOST_MODES.map((value) => ({
          value,
          label: t(`location.ghost.${value}`),
          icon: GHOST_ICONS[value],
        }))}
      />
      <Hint>{t(`location.ghost.${ghost}Detail`)}</Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg },
  ghost: { gap: space.sm },
  historyActions: { flexDirection: 'row', gap: space.sm },
  historyAction: { flex: 1 },
});

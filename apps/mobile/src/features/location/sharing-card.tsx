import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { SectionTitle } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';
import { Toggle } from '@/ui/toggle';

import { useNow } from './clock';
import { updateSharing } from './location-session';
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
    ? t('location.sharing.ghostOn')
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
        </>
      ) : null}
    </View>
  );
}

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
        options={GHOST_MODES.map((value) => ({ value, label: t(`location.ghost.${value}`) }))}
      />
      <Text variant="footnote" color="textMuted">
        {t(`location.ghost.${ghost}Detail`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg },
  ghost: { gap: space.sm },
});

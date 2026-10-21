import { X } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { elevation, radius, space, touchTarget, useTheme } from '@/theme';
import { Text } from '@/ui/text';

import { useCircles } from '../../circles/queries';
import { memberName } from '../../circles/names';
import { nativeCryptoSelfTestMs } from '../../../platform/native-crypto';
import { useFrameMeter } from '../frame-meter';
import { STALL_MS } from './stalls';
import {
  median,
  resetBackgroundLive,
  restoreBackgroundLive,
  type Series,
  useMeasures,
  useStalls,
} from './store';
import { startStallWatch } from './watch';

/** Frame rate measured in windows this long, one after another, while the overlay is open. */
const FPS_WINDOW_SECONDS = 2;
/** Where the panel starts below the safe area: under the "who sees me" pill. */
const PANEL_TOP = 140;
const PANEL_WIDTH = 260;
const CLOSE_ICON = 18;
/** The latest stalls listed (all are counted). */
const STALLS_SHOWN = 6;

/** "1,2 sn" / "1.2 s", or a dash with nothing measured yet. */
function useSeconds() {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (ms: number | null) =>
    ms === null ? '—' : t('dev.measure.seconds', { s: format.format(ms / 1000) });
}

function gapOf(series: Series): number | null {
  return median(series.gaps);
}

/**
 * The measurement overlay (preview builds only, docs/ADR/0028): how often this phone takes and
 * sends its location, what the filter dropped, how late and how often friends' locations arrive,
 * and the screen's frame rate. Reads only the measures (in memory, and the counters of background
 * live mode, which this phone also keeps); shows no position.
 */
export function MeasureOverlay() {
  const open = useMeasures((state) => state.open);
  return open ? <Panel /> : null;
}

function Panel() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const seconds = useSeconds();
  const measures = useMeasures();
  const circles = useCircles().data ?? [];
  const meter = useFrameMeter(FPS_WINDOW_SECONDS);
  const stalls = useStalls();
  const { running, start } = meter;
  // The kept counters of background live mode (the app may have been closed since they were counted).
  useEffect(() => {
    restoreBackgroundLive();
  }, []);
  // One window after another while open.
  useEffect(() => {
    if (!running) start();
  }, [running, start]);

  const nameOf = (userId: string) => {
    for (const circle of circles) {
      const card = circle.members.find((member) => member.userId === userId);
      if (card !== undefined) return memberName(card);
    }
    return '?';
  };
  const { outcomes } = measures;
  const friends = Object.entries(measures.friends);
  const line = (text: string) => (
    <Text variant="caption" color="textMuted" key={text}>
      {text}
    </Text>
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.panel,
        {
          top: insets.top + PANEL_TOP,
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.border,
          boxShadow: elevation.floating,
        },
      ]}
    >
      <View style={styles.header}>
        <Text variant="subhead">{t('dev.measure.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dev.measure.close')}
          hitSlop={(touchTarget - CLOSE_ICON) / 2}
          onPress={() => {
            useMeasures.setState({ open: false });
          }}
        >
          <X color={colors.textMuted} size={CLOSE_ICON} strokeWidth={2.25} />
        </Pressable>
      </View>

      <Text variant="caption">{t('dev.measure.phone')}</Text>
      {line(
        t('dev.measure.samples', {
          service: seconds(gapOf(measures.sources.service)),
          live: seconds(gapOf(measures.sources.live)),
        }),
      )}
      {line(
        t('dev.measure.age', {
          age: seconds(measures.ageMs),
          acc: measures.acc === null ? '—' : Math.round(measures.acc),
        }),
      )}
      {line(
        t('dev.measure.sends', {
          gap: seconds(gapOf(measures.sends)),
          mode: measures.live ? t('dev.measure.modeLive') : t('dev.measure.modeNormal'),
        }),
      )}
      {line(t('dev.measure.dropped', outcomes))}
      {line(t('dev.measure.fallback', { count: outcomes.fallback }))}

      <Text variant="caption" style={styles.section}>
        {t('dev.measure.background')}
      </Text>
      {line(
        t('dev.measure.backgroundOpened', {
          notices: measures.backgroundLive.notices,
          opened: measures.backgroundLive.opened,
          minutes: Math.round((measures.backgroundLive.openedMs / 60_000) * 10) / 10,
        }),
      )}
      {line(t('dev.measure.backgroundRefused', measures.backgroundLive.refused))}
      <Pressable
        accessibilityRole="button"
        testID="background-reset"
        hitSlop={space.sm}
        onPress={resetBackgroundLive}
      >
        <Text variant="caption" color="primary">
          {t('dev.measure.backgroundReset')}
        </Text>
      </Pressable>

      <Text variant="caption" style={styles.section}>
        {t('dev.measure.friends')}
      </Text>
      {friends.length === 0
        ? line(t('dev.measure.noFriends'))
        : friends.map(([userId, friend]) =>
            line(
              t('dev.measure.friend', {
                name: nameOf(userId),
                delay: seconds(friend.delayMs),
                gap: seconds(gapOf(friend.measured)),
                acc: Math.round(friend.acc),
                late: friend.late,
              }),
            ),
          )}

      <Text variant="caption" style={styles.section}>
        {t('dev.measure.screen')}
      </Text>
      {line(
        meter.report === null
          ? t('dev.measure.fpsWaiting')
          : t('dev.measure.fps', {
              fps: meter.report.averageFps,
              worst: meter.report.worstFrameMs,
            }),
      )}

      <Text variant="caption" style={styles.section}>
        {t('dev.measure.stalls')}
      </Text>
      {line(t('dev.measure.selfTest', { ms: nativeCryptoSelfTestMs }))}
      {stalls.watching ? null : (
        <Pressable
          accessibilityRole="button"
          testID="stalls-again"
          hitSlop={space.sm}
          onPress={startStallWatch}
        >
          <Text variant="caption" color="primary">
            {t('dev.measure.stallsAgain')}
          </Text>
        </Pressable>
      )}
      {stalls.list.length === 0
        ? line(
            stalls.watching
              ? t('dev.measure.stallsWatching')
              : t('dev.measure.stallsNone', { ms: STALL_MS }),
          )
        : [
            line(
              t('dev.measure.stallsCount', {
                count: stalls.list.length,
                ms: Math.max(...stalls.list.map((stall) => stall.ms)),
              }),
            ),
            ...stalls.list.slice(-STALLS_SHOWN).map((stall) =>
              line(
                t('dev.measure.stall', {
                  at: seconds(stall.at),
                  ms: stall.ms,
                  name: stall.name ?? t('dev.measure.stallUnnamed'),
                }),
              ),
            ),
          ]}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: space.sm,
    width: PANEL_WIDTH,
    padding: space.md,
    gap: space.xxs,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.94,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  section: { marginTop: space.xs },
});

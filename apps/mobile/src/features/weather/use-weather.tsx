import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, touchTarget, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Text } from '@/ui/text';

import { api, onSignedOut } from '../auth/auth-store';
import { onLiveMessage, onOnline } from '../live/live-session';
import { useMyFix } from '../location/engine';
import {
  parseSnapshot,
  useWeather,
  type WeatherHere,
  weatherCellAt,
  weatherEmoji,
  weatherOfCell,
} from './weather';

/** Fetches the shared weather grid (the same for everyone; no location in the request). */
async function load(): Promise<void> {
  try {
    useWeather.setState({ snapshot: parseSnapshot(await api.authed('/v1/weather')) });
  } catch {
    // None yet or offline: no weather on the map until the next announcement.
  }
}

// On every (re)connection, and whenever the server announces a new snapshot (no polling).
onOnline(() => void load());
onLiveMessage((name) => {
  if (name === 'weather') void load();
});
onSignedOut(() => {
  useWeather.setState({ snapshot: null });
});

/** The weather where this phone is, looked up on the phone from the shared grid. */
export function useWeatherHere(): WeatherHere | null {
  const snapshot = useWeather((state) => state.snapshot);
  // The cell, a number: the phone's position changes every second with the map open, the cell
  // hardly ever, and the map screen (and the weather drawing under it) is redrawn only with it.
  const cell = useMyFix((state) =>
    snapshot === null || state.fix === null ? null : weatherCellAt(snapshot, state.fix),
  );
  return useMemo(
    () => (snapshot === null || cell === null ? null : weatherOfCell(snapshot, cell)),
    [snapshot, cell],
  );
}

/**
 * The weather here, a small card beside "who sees me" (the theme of 2026-10-18): "☁ 12°" and, when
 * the map names it around this phone, the town (map labels, never a request: docs/ADR/0013). Read
 * out as a sentence.
 */
export function WeatherChip({ here, town }: { here: WeatherHere; town: string | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const temperature = Math.round(here.temperature);
  const said = t('weather.label', { kind: t(`weather.kinds.${here.kind}`), temperature });
  return (
    <Animated.View entering={motion.fadeIn}>
      <View
        testID="weather-chip"
        accessible
        accessibilityLabel={town === null ? said : `${said}, ${town}`}
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            boxShadow: elevation.floating,
          },
        ]}
      >
        <Text variant="bodyStrong" allowFontScaling={false}>
          {`${weatherEmoji(here)} ${String(temperature)}°`}
        </Text>
        {/* One line, as thin as "who sees me" (the owner, 2026-10-23): a long town shortens. */}
        {town === null ? null : (
          <Text
            variant="footnote"
            color="textMuted"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={styles.town}
          >
            {town}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: touchTarget,
    flexDirection: 'row',
    gap: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  town: { maxWidth: touchTarget * 2 },
});

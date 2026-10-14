import { useTranslation } from 'react-i18next';
import Animated from 'react-native-reanimated';

import { useMotion } from '@/theme/use-motion';
import { Pill } from '@/ui/pill';
import { Text } from '@/ui/text';

import { api, onSignedOut } from '../auth/auth-store';
import { onLiveMessage, onOnline } from '../live/live-session';
import { useMyFix } from '../location/engine';
import { parseSnapshot, useWeather, type WeatherHere, weatherAt, weatherEmoji } from './weather';

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
  const fix = useMyFix((state) => state.fix);
  if (snapshot === null || fix === null) return null;
  return weatherAt(snapshot, fix);
}

/** "☀️ 24°" under "who sees me"; read out as a sentence. */
export function WeatherChip({ here }: { here: WeatherHere }) {
  const { t } = useTranslation();
  const motion = useMotion();
  const temperature = Math.round(here.temperature);
  return (
    <Animated.View entering={motion.fadeIn}>
      <Pill
        testID="weather-chip"
        accessibilityLabel={t('weather.label', {
          kind: t(`weather.kinds.${here.kind}`),
          temperature,
        })}
      >
        <Text variant="subhead" allowFontScaling={false}>
          {`${weatherEmoji(here)} ${String(temperature)}°`}
        </Text>
      </Pill>
    </Animated.View>
  );
}

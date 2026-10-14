import { MapPinOff, WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Pill } from '@/ui/pill';
import { Text } from '@/ui/text';

import { useConnection } from '../live/live-session';
import { requestLocationPermission, useLocationPermission } from './tracker';

/** A connection that comes back this fast is not worth a line on screen (no flicker on open). */
export const CONNECTING_GRACE_MS = 2_000;

function useConnecting(): boolean {
  const online = useConnection((state) => state.online);
  const drops = useConnection((state) => state.drops);
  // The outage whose grace time has passed; a later outage starts its own wait.
  const [late, setLate] = useState<number | null>(null);
  useEffect(() => {
    if (online) return;
    const timer = setTimeout(() => {
      setLate(drops);
    }, CONNECTING_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [online, drops]);
  return !online && late === drops;
}

/**
 * Under "who sees me": what keeps the map from being current. Without the location permission a
 * card says why it matters and asks (or points to the settings once refused); while the live
 * connection is down, a quiet "Connecting…" line (it reconnects on its own, BARGU_PLAN §3.4).
 */
export function LocationBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const permission = useLocationPermission((state) => state.state);
  const connecting = useConnecting();

  if (permission === 'undetermined' || permission === 'blocked') {
    const blocked = permission === 'blocked';
    return (
      <Animated.View
        entering={motion.enterDown}
        testID="location-permission"
        style={[
          styles.card,
          { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
        ]}
      >
        <View style={styles.head}>
          <MapPinOff color={colors.primary} size={22} strokeWidth={2.25} />
          <View style={styles.text}>
            <Text variant="bodyStrong">{t('location.permission.title')}</Text>
            <Text variant="footnote" color="textMuted">
              {blocked ? t('location.permission.blockedBody') : t('location.permission.body')}
            </Text>
          </View>
        </View>
        <Button
          label={blocked ? t('location.permission.settings') : t('location.permission.allow')}
          onPress={() => {
            if (blocked) void Linking.openSettings();
            else void requestLocationPermission();
          }}
        />
      </Animated.View>
    );
  }

  if (!connecting) return null;
  return (
    <Animated.View entering={motion.fadeIn} testID="connecting">
      <Pill accessibilityLabel={t('main.connecting')}>
        <WifiOff color={colors.textMuted} size={16} strokeWidth={2.25} />
        <Text variant="footnote" color="textMuted">
          {t('main.connecting')}
        </Text>
      </Pill>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg, alignSelf: 'stretch' },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xxs },
});

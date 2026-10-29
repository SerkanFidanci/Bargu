import { router } from 'expo-router';
import { Ghost, MapPinOff, ShieldAlert, WifiOff } from 'lucide-react-native';
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
import { turnGhostOn } from './ghost-now';
import { useMapCardTurn } from './map-cards';
import { useSharing, useSharingUnreadable } from './sharing';
import { requestLocationPermission, useLocationPermission, useLocationServices } from './tracker';
import { useMyWhy, type Why } from './why';

/** A connection that comes back this fast is not worth a line on screen (no flicker on open). */
const CONNECTING_GRACE_MS = 2_000;

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
 * What friends see because of this, and the quiet way to hide instead (QA-33 N-2, docs/ADR/0028):
 * turning the location permission or the location services off tells the circles "Konum izni
 * kapalı" or "Konum alınamıyor" (and since when). Someone who wanted to hide may not expect that;
 * ghost mode is the way to disappear without a word, and it is one tap here.
 */
function GhostHint({ what }: { what: Why }) {
  const { t } = useTranslation();
  return (
    <View testID="ghost-hint" style={styles.hint}>
      <Text variant="footnote" color="textMuted">
        {t('location.ghostHint', { what: t(`ui.marker.why.${what}`) })}
      </Text>
      <Button
        testID="ghost-hint-on"
        variant="secondary"
        icon={Ghost}
        label={t('location.ghostNow')}
        onPress={turnGhostOn}
      />
    </View>
  );
}

/**
 * Under "who sees me": what keeps the map from being current. Without the location permission a
 * card says why it matters and asks (or points to the settings once refused); with the phone's
 * location services off, a card says so; while the live connection is down, a quiet
 * "Connecting…" line (it reconnects on its own, BARGU_PLAN §3.4). The first two also say what the
 * circles are being told because of it, with ghost mode one tap away.
 */
export function LocationBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const permission = useLocationPermission((state) => state.state);
  const connecting = useConnecting();
  // "Şimdi değil": asked again the next time the app starts.
  const [later, setLater] = useState(false);
  const asking = (permission === 'undetermined' && !later) || permission === 'blocked';
  // What the circles are being told about this phone's location right now (a ghost tells none).
  const told = useMyWhy((state) => state.current);
  const ghostOff = useSharing((state) => state.ghost === 'off');
  const servicesOff = useLocationServices((state) => state.state) === 'off';
  // The services are off and the circles hear of it; with no permission that card comes first.
  const services = !asking && permission === 'granted' && servicesOff && told?.why === 'nofix';
  // Settings that could not be read share with nobody (the PM, 2026-10-29): said first.
  const unreadable = useSharingUnreadable((state) => state.unreadable);
  // The first card on the map: the others wait for it (map-cards.ts).
  const turn = useMapCardTurn('locationPermission', unreadable || asking || services);

  if (unreadable) {
    if (!turn) return null;
    return (
      <Animated.View
        entering={motion.enterDown}
        testID="sharing-unreadable"
        style={[
          styles.card,
          { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
        ]}
      >
        <View style={styles.head}>
          <ShieldAlert color={colors.danger} size={22} strokeWidth={2.25} />
          <View style={styles.text}>
            <Text variant="bodyStrong">{t('location.unreadable.title')}</Text>
            <Text variant="footnote" color="textMuted">
              {t('location.unreadable.body')}
            </Text>
          </View>
        </View>
        <Button
          testID="sharing-unreadable-check"
          label={t('location.unreadable.check')}
          onPress={() => {
            useSharingUnreadable.setState({ unreadable: false });
            router.push('/settings/location');
          }}
        />
      </Animated.View>
    );
  }

  if (services) {
    if (!turn) return null;
    return (
      <Animated.View
        entering={motion.enterDown}
        testID="location-services"
        style={[
          styles.card,
          { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
        ]}
      >
        <View style={styles.head}>
          <MapPinOff color={colors.primary} size={22} strokeWidth={2.25} />
          <View style={styles.text}>
            <Text variant="bodyStrong">{t('location.services.title')}</Text>
            <Text variant="footnote" color="textMuted">
              {t('location.services.body')}
            </Text>
          </View>
        </View>
        {ghostOff ? <GhostHint what="nofix" /> : null}
        <Button
          testID="location-services-settings"
          label={t('location.permission.settings')}
          onPress={() => void Linking.openSettings()}
        />
      </Animated.View>
    );
  }

  if (asking) {
    if (!turn) return null;
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
        {ghostOff && told?.why === 'permission' ? <GhostHint what="permission" /> : null}
        {blocked ? (
          <Button
            label={t('location.permission.settings')}
            onPress={() => void Linking.openSettings()}
          />
        ) : (
          // The disclosure first, the system dialog only after "Devam et" (Google Play K10).
          <View style={styles.actions}>
            <View style={styles.half}>
              <Button
                testID="location-continue"
                label={t('location.permission.allow')}
                onPress={() => void requestLocationPermission()}
              />
            </View>
            <View style={styles.half}>
              <Button
                testID="location-later"
                variant="secondary"
                label={t('location.permission.later')}
                onPress={() => {
                  setLater(true);
                }}
              />
            </View>
          </View>
        )}
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
  actions: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg, alignSelf: 'stretch' },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  hint: { gap: space.sm },
  text: { flex: 1, gap: space.xxs },
});

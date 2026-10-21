import { router } from 'expo-router';
import { Zap } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { useMapCardTurn } from '../map-cards';
import { backgroundLiveOn, useSharing } from '../sharing';
import { dismissCard, restoreCard, useCardSeen } from './notice-card';

/**
 * The one-time explanation of background live mode (docs/ADR/0028 step 3), on the map the first
 * time the app opens with it on (18+ starts with it on, so the user learns of it before or soon
 * after it first happens): "Biri haritada sana bakarken konumun birkaç dakika daha sık gider; pil
 * biraz daha harcanır. Ayarlardan kapatabilirsin." Never shown for a teen who has it off.
 */
export function BackgroundLiveCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const on = backgroundLiveOn(useSharing());
  const seen = useCardSeen((state) => state.seen);
  useEffect(() => {
    restoreCard();
  }, []);
  // The last card on the map: it waits for the others to be answered (location/map-cards.ts).
  const turn = useMapCardTurn('backgroundLive', on && !seen);
  if (!on || seen || !turn) return null;
  return (
    <Animated.View
      entering={motion.enterDown}
      testID="background-live-card"
      style={[
        styles.card,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
      ]}
    >
      <View style={styles.head}>
        <Zap color={colors.primary} size={22} strokeWidth={2.25} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{t('location.backgroundLive.card.title')}</Text>
          <Text variant="footnote" color="textMuted">
            {t('location.backgroundLive.card.body')}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.half}>
          <Button
            testID="background-live-card-ok"
            label={t('location.backgroundLive.card.ok')}
            onPress={dismissCard}
          />
        </View>
        <View style={styles.half}>
          <Button
            testID="background-live-card-settings"
            variant="secondary"
            label={t('location.backgroundLive.card.settings')}
            onPress={() => {
              dismissCard();
              router.push('/settings/location');
            }}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg, alignSelf: 'stretch' },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xxs },
  actions: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
});

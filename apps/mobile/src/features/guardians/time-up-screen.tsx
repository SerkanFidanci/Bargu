import { Hourglass, PauseCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { stopSharing } from '../location/location-session';
import { dailyLimit } from './screen-time';
import { useScreenTime } from './screen-time-session';

/**
 * The daily limit a parent set is reached (docs/ADR/0023 §5): the app is closed until tomorrow.
 * The location keeps going in the background (safety); stopping it stays possible (privacy).
 */
export function TimeUpScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const limit = useScreenTime((state) => dailyLimit(state.rules));

  return (
    <Animated.View
      entering={motion.fadeIn}
      testID="time-up"
      accessibilityViewIsModal
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <Hourglass color={colors.primary} size={32} strokeWidth={2.25} />
      </View>
      <Text variant="title2" align="center">
        {t('screenTime.upTitle')}
      </Text>
      <Text variant="callout" color="textMuted" align="center">
        {t('screenTime.upBody', { minutes: limit ?? 0 })}
      </Text>
      <Text variant="footnote" color="textMuted" align="center">
        {t('screenTime.sharingGoesOn')}
      </Text>
      <Button
        testID="time-up-stop"
        label={t('screenTime.stopSharing')}
        icon={PauseCircle}
        variant="secondary"
        onPress={() => {
          stopSharing();
          toast.success(t('screenTime.stopped'));
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  badge: {
    width: space.xxxl + space.lg,
    height: space.xxxl + space.lg,
    borderRadius: space.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

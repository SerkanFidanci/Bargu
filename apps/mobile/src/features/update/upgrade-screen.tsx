import { CircleFadingArrowUp } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Text } from '@/ui/text';

/**
 * This app is older than the server serves (QA 19 P4): it replaces the whole app until the new
 * version is installed. Nothing to press: the update comes from the download link or the store.
 */
export function UpgradeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();

  return (
    <Animated.View
      entering={motion.fadeIn}
      testID="upgrade-required"
      accessibilityViewIsModal
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <CircleFadingArrowUp color={colors.primary} size={32} strokeWidth={2.25} />
      </View>
      <Text variant="title2" align="center">
        {t('upgrade.title')}
      </Text>
      <Text variant="callout" color="textMuted" align="center">
        {t('upgrade.body')}
      </Text>
      <Text variant="footnote" color="textMuted" align="center">
        {t('upgrade.where')}
      </Text>
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

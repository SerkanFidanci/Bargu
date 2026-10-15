import { ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { finishSharingReview } from './location-session';
import { useSharingReview } from './sharing';

/**
 * After a reinstall or on a new phone: the location goes to none of the user's circles until they
 * choose (their earlier choices stayed on the old phone). Share with all again, or pick each.
 */
export function NewPhoneCard({ onChoose }: { onChoose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const pending = useSharingReview((state) => state.pending);
  if (!pending) return null;
  return (
    <Animated.View
      entering={motion.enterDown}
      testID="new-phone"
      style={[
        styles.card,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
      ]}
    >
      <View style={styles.head}>
        <ShieldCheck color={colors.primary} size={22} strokeWidth={2.25} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{t('location.newPhone.title')}</Text>
          <Text variant="footnote" color="textMuted">
            {t('location.newPhone.body')}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          testID="share-all"
          label={t('location.newPhone.shareAll')}
          onPress={() => {
            finishSharingReview(true);
          }}
        />
        <Button
          testID="choose-circles"
          variant="secondary"
          label={t('location.newPhone.choose')}
          onPress={() => {
            finishSharingReview(false);
            onChoose();
          }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg, alignSelf: 'stretch' },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xxs },
  actions: { gap: space.sm },
});

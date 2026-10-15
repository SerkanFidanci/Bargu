import { router } from 'expo-router';
import { Eye } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { useAuth } from '../auth/auth-store';
import { memberName, partnerOf } from '../circles/names';
import { useCircles } from '../circles/queries';
import { historyAudience } from '../history/viewers';
import { useNow } from './clock';
import { reviewSharing } from './location-session';
import { seersByCircle, useSharing } from './sharing';
import { anyoneSees, reminderDue, reminderSummary, useSharingReminder } from './sharing-reminder';

/**
 * The weekly reminder on the map (BARGU_PLAN Faz 9): "Konumunu 5 kişi görüyor (Aile 3, Ekip 2);
 * konum geçmişini 2 kişi görüyor". "Tamam" counts a new week from now; "Düzenle" opens who sees
 * the user, where all of it stops with one tap. Nothing shows while nobody sees anything.
 */
export function SharingReminderCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const me = useAuth((state) => state.userId);
  const reviewedAt = useSharingReminder((state) => state.reviewedAt);
  const circles = useCircles().data ?? [];
  const settings = useSharing();
  const now = useNow();
  if (me === null || !reminderDue(reviewedAt, now)) return null;
  const summary = reminderSummary(
    seersByCircle(circles, settings, me, now),
    historyAudience(circles, settings, me),
    (circle) => {
      const partner = circle.kind === 'pair' ? partnerOf(circle, me) : undefined;
      return partner === undefined ? (circle.name ?? '') : memberName(partner);
    },
  );
  if (!anyoneSees(summary)) return null;
  const text = [
    summary.people > 0
      ? t('location.reminder.location', {
          count: summary.people,
          circles: summary.circles.map(({ name, count }) => `${name} ${String(count)}`).join(', '),
        })
      : null,
    summary.historyPeople > 0
      ? t('location.reminder.history', { count: summary.historyPeople })
      : null,
  ]
    .filter((part) => part !== null)
    .join('; ');
  return (
    <Animated.View
      entering={motion.enterDown}
      testID="sharing-reminder"
      style={[
        styles.card,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
      ]}
    >
      <View style={styles.head}>
        <Eye color={colors.primary} size={22} strokeWidth={2.25} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{t('location.reminder.title')}</Text>
          <Text variant="footnote" color="textMuted">
            {text}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.half}>
          <Button
            testID="sharing-reminder-ok"
            label={t('location.reminder.ok')}
            onPress={() => {
              reviewSharing();
            }}
          />
        </View>
        <View style={styles.half}>
          <Button
            testID="sharing-reminder-edit"
            variant="secondary"
            label={t('location.reminder.edit')}
            onPress={() => {
              reviewSharing();
              router.push('/seers');
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

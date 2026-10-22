import { Bell } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { useAuth } from '../auth/auth-store';
import { useCircles } from '../circles/queries';
import { useMapCardTurn } from '../location/map-cards';
import { useLocationPermission } from '../location/tracker';
import { vault } from '../storage/vault';
import { usePushState } from './push';
import { askForPush } from './use-push';

/** "Şimdi değil" hides the question this long (BARGU_PLAN K11: asked in context, not pressed). */
const PUSH_SNOOZE_MS = 7 * 24 * 3600 * 1000;
const SNOOZE_KEY = 'push:snooze:v1';

function snoozedUntil(): number {
  try {
    return Number(vault().get(SNOOZE_KEY) ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Notifications are asked for in context (Google Play K11, docs/ADR/0022): once the user has
 * someone to hear from (a circle with another member), after the location question, with what they
 * are for. "Şimdi değil" asks again in a week; refused, the app works without them.
 */
export function NotificationCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const push = usePushState((state) => state.state);
  const location = useLocationPermission((state) => state.state);
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const [hidden, setHidden] = useState(() => snoozedUntil() > Date.now());
  const someone = circles.some(
    (circle) =>
      circle.myStatus === 'active' &&
      circle.members.some((member) => member.userId !== me && member.status === 'active'),
  );
  const asking = push === 'undetermined' && location !== 'undetermined' && someone && !hidden;
  // After the cards in front of it on the map, one at a time (location/map-cards.ts).
  const turn = useMapCardTurn('notificationPrompt', asking);
  if (!asking || !turn) return null;
  return (
    <Animated.View
      entering={motion.enterDown}
      testID="notification-prompt"
      style={[
        styles.card,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
      ]}
    >
      <View style={styles.head}>
        <Bell color={colors.primary} size={22} strokeWidth={2.25} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{t('notifications.prompt.title')}</Text>
          <Text variant="footnote" color="textMuted">
            {t('notifications.prompt.body')}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.half}>
          <Button
            testID="notification-allow"
            label={t('notifications.prompt.allow')}
            onPress={() => void askForPush()}
          />
        </View>
        <View style={styles.half}>
          <Button
            testID="notification-later"
            variant="secondary"
            label={t('notifications.prompt.later')}
            onPress={() => {
              try {
                vault().set(SNOOZE_KEY, String(Date.now() + PUSH_SNOOZE_MS));
              } catch {
                // Not kept: asked again next time.
              }
              setHidden(true);
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

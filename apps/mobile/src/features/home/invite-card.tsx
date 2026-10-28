import { router } from 'expo-router';
import { UserPlus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { useAuth } from '../auth/auth-store';
import { useCircles } from '../circles/queries';
import { useShareInvite } from '../circles/share-invite';
import { useMapCardTurn } from '../location/map-cards';

/**
 * The empty map's one invitation (the PM report T7, 2026-10-29: "Boş harita, yeni kullanıcının
 * bıraktığı ilk yer"): with nobody to see yet, a link to send, or a QR code to show in person. It
 * stays until someone is there; the cards that ask something come before it.
 */
export function InviteCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data;
  const invite = useShareInvite();
  const alone =
    circles !== undefined &&
    !circles.some(
      (circle) =>
        circle.myStatus === 'active' &&
        circle.members.some((member) => member.userId !== me && member.status === 'active'),
    );
  const turn = useMapCardTurn('invite', alone);
  if (!alone || !turn) return null;
  return (
    <Animated.View
      entering={motion.enterDown}
      testID="invite-card"
      style={[
        styles.card,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
      ]}
    >
      <View style={styles.head}>
        <UserPlus color={colors.primary} size={22} strokeWidth={2.25} />
        <View style={styles.text}>
          <Text variant="bodyStrong">{t('main.invite.title')}</Text>
          <Text variant="footnote" color="textMuted">
            {t('main.invite.body')}
          </Text>
        </View>
      </View>
      <Button
        testID="invite-share"
        label={t('main.invite.share')}
        loading={invite.sharing}
        onPress={() => void invite.share()}
      />
      <Button
        testID="invite-qr"
        variant="ghost"
        label={t('main.invite.qr')}
        onPress={() => {
          router.push('/add/qr');
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, alignSelf: 'stretch' },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xxs },
});

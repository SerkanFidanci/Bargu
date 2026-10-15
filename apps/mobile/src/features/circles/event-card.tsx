import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import { DoorClosed, Flag, QrCode, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { useNow } from '../location/clock';
import { endText, timeLeftText } from './event-ui';
import { circlesApi } from './circles-api';
import { useCircleActions } from './queries';

/**
 * What an event circle adds to its screen (BARGU_PLAN Faz 8): when it ends and that everything
 * goes with it, its QR code for joining, and, for its owner, ending it now.
 */
export function EventCard({ circle }: { circle: Circle }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const actions = useCircleActions();
  if (circle.expiresAt === undefined) return null;
  const expiresAt = circle.expiresAt;

  const endNow = () => {
    Alert.alert(t('circles.event.endConfirmTitle'), t('circles.event.endConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('circles.event.endNow'),
        style: 'destructive',
        onPress: () => {
          actions.end.mutate(circle.id, {
            onSuccess: () => {
              toast.info(t('circles.event.ended'));
              router.back();
            },
          });
        },
      },
    ]);
  };

  // A QR code that leaked, whoever made it: every open one stops working (QA Faz 8 O2).
  const closeDoor = () => {
    Alert.alert(t('circles.event.closeDoorTitle'), t('circles.event.closeDoorBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('circles.event.closeDoor'),
        style: 'destructive',
        onPress: () => {
          circlesApi
            .revokeAllInvites(circle.id)
            .then(() => {
              toast.success(t('circles.event.doorClosed'));
            })
            .catch(() => {
              toast.error(t('add.qr.revokeFailed'));
            });
        },
      },
    ]);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceRaised }]} testID="event-card">
      <View style={styles.head}>
        <Flag color={colors.primary} size={20} strokeWidth={2.25} />
        <View style={styles.text}>
          <Text variant="bodyStrong">
            {endText(t, expiresAt, now, i18n.language)} · {timeLeftText(t, expiresAt, now)}
          </Text>
          <Text variant="footnote" color="textMuted">
            {t('circles.event.note')}
          </Text>
        </View>
      </View>
      <Button
        testID="event-qr"
        label={t('circles.event.qr')}
        icon={QrCode}
        onPress={() => {
          router.push({ pathname: '/add/qr', params: { circle: circle.id } });
        }}
      />
      {circle.myRole === 'owner' ? (
        <Button
          testID="event-close-door"
          label={t('circles.event.closeDoor')}
          icon={DoorClosed}
          variant="secondary"
          onPress={closeDoor}
        />
      ) : null}
      {circle.myRole === 'owner' ? (
        <Button
          testID="event-end"
          label={t('circles.event.endNow')}
          icon={Trash2}
          variant="danger"
          loading={actions.end.isPending}
          onPress={endNow}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xxs },
});

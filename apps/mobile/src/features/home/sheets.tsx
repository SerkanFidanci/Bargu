import type { Me } from '@bargu/schemas';
import { router } from 'expo-router';
import {
  LogOut,
  type LucideIcon,
  Pencil,
  QrCode,
  Search,
  Share2,
  Smartphone,
  Users,
  Wrench,
} from 'lucide-react-native';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { DEV_TOOLS_ENABLED, env } from '@/config/env';
import { signOut } from '@/features/auth/auth-store';
import { radius, space, touchTarget, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { PressableScale } from '@/ui/pressable-scale';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

export const CirclesSheet = forwardRef<SheetRef, { onAdd: () => void }>(function CirclesSheet(
  { onAdd },
  ref,
) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t('sheets.circles.title')} testID="circles-sheet">
      <EmptyState
        icon={Users}
        title={t('sheets.circles.emptyTitle')}
        body={t('sheets.circles.emptyBody')}
        action={{ label: t('sheets.circles.emptyAction'), onPress: onAdd }}
      />
    </Sheet>
  );
});

/** Friend-adding entry points; the flows themselves arrive with circles and invites (Faz 4). */
export const AddSheet = forwardRef<SheetRef>(function AddSheet(_props, ref) {
  const { t } = useTranslation();
  const soon = () => {
    toast.info(t('sheets.add.soon'));
  };
  return (
    <Sheet ref={ref} title={t('sheets.add.title')} testID="add-sheet">
      <Row
        icon={Search}
        label={t('sheets.add.byUsername')}
        detail={t('common.soon')}
        onPress={soon}
      />
      <Row icon={QrCode} label={t('sheets.add.showQr')} detail={t('common.soon')} onPress={soon} />
      <Row
        icon={Share2}
        label={t('sheets.add.shareLink')}
        detail={t('common.soon')}
        onPress={soon}
      />
    </Sheet>
  );
});

export const MeSheet = forwardRef<SheetRef, { me: Me; onClose: () => void }>(function MeSheet(
  { me, onClose },
  ref,
) {
  const { t } = useTranslation();
  const confirmSignOut = () => {
    Alert.alert(t('sheets.me.logoutTitle'), t('sheets.me.logoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('sheets.me.logout'),
        style: 'destructive',
        onPress: () => {
          onClose();
          void signOut();
        },
      },
    ]);
  };

  return (
    <Sheet ref={ref} title={t('sheets.me.title')} testID="me-sheet">
      <View style={styles.profile}>
        <Avatar avatar={me.avatar} name={me.displayName ?? '?'} size="lg" />
        <View style={styles.profileText}>
          <Text variant="title2">{me.displayName}</Text>
          <Text variant="callout" color="textMuted">{`@${me.username ?? ''}`}</Text>
        </View>
      </View>
      <Button
        label={t('sheets.me.editProfile')}
        icon={Pencil}
        variant="secondary"
        onPress={() => {
          onClose();
          router.push('/edit-profile');
        }}
      />
      <Row
        icon={Smartphone}
        label={t('sheets.me.device')}
        detail={
          me.device.attested ? t('sheets.me.deviceAttested') : t('sheets.me.deviceNotAttested')
        }
      />
      {DEV_TOOLS_ENABLED ? (
        <>
          <Row
            icon={Wrench}
            label={t('dev.ui.link')}
            onPress={() => {
              onClose();
              router.push('/_dev/ui');
            }}
          />
          <Row
            icon={Wrench}
            label={t('home.devTools')}
            onPress={() => {
              onClose();
              router.push('/_dev/crypto');
            }}
          />
        </>
      ) : null}
      <Button
        testID="sign-out"
        label={t('sheets.me.logout')}
        icon={LogOut}
        variant="ghost"
        onPress={confirmSignOut}
      />
      <Text variant="caption" color="textMuted" align="center">
        {t('sheets.me.version', { version: env.appVersion })}
      </Text>
    </Sheet>
  );
});

function Row({
  icon: Icon,
  label,
  detail,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon color={colors.primary} size={20} strokeWidth={2.25} />
      </View>
      <View style={styles.rowText}>
        <Text variant="body">{label}</Text>
        {detail === undefined ? null : (
          <Text variant="footnote" color="textMuted">
            {detail}
          </Text>
        )}
      </View>
    </>
  );
  if (onPress === undefined) {
    return (
      <View
        style={styles.row}
        accessible
        accessibilityLabel={detail ? `${label}, ${detail}` : label}
      >
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      haptic="select"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={styles.row}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  profileText: { flex: 1, gap: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget },
  rowIcon: {
    width: touchTarget - space.sm,
    height: touchTarget - space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: space.xxs },
});

import type { Me } from '@bargu/schemas';
import { router } from 'expo-router';
import {
  Bell,
  HandHeart,
  Info,
  LogOut,
  Palette,
  Pencil,
  ShieldCheck,
  ShieldHalf,
  Smile,
  Sparkles,
  UserCog,
} from 'lucide-react-native';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { env } from '@/config/env';
import { signOut, useAuth } from '@/features/auth/auth-store';
import { usePlan } from '@/features/billing/plan';
import { daysLeft } from '@/features/billing/plan-model';
import { useCircles } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import { seersOf, useSharing } from '@/features/location/sharing';
import { useMapAppearance } from '@/features/map/appearance';
import { usePushState } from '@/features/notifications/push';
import { useMyStatus } from '@/features/social/status';
import { space } from '@/theme';
import { useEffectChoice } from '@/theme/effects';
import { Appear } from '@/ui/appear';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { SettingsGroup, SettingsRow } from '@/ui/settings-row';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';

import { leaveSheet, rememberScroll, useSheetReturn } from './sheet-return';

type MeScreen =
  | '/edit-profile'
  | '/settings/location'
  | '/notifications'
  | '/settings/look'
  | '/security'
  | '/plus'
  | '/privacy'
  | '/settings/about';

/**
 * "Ben" (the owner, 2026-10-21: "tıklanınca kendi ekranları açılacak, açık şekilde durmasın"): the
 * profile, then one row per part, each with what it is set to now and its own screen behind it, as
 * in the phone's settings. "Konum ve gizlilik" right under the profile (the PM: the safety
 * switches are never missed). Coming back from a screen opens this sheet again where it was.
 */
export const MeSheet = forwardRef<
  SheetRef,
  { me: Me; onClose: () => void; onStatus: () => void; onSafe: () => void; onDismiss?: () => void }
>(function MeSheet({ me, onClose, onStatus, onSafe, onDismiss }, ref) {
  const { t } = useTranslation();
  const push = usePushState((state) => state.state);
  const myStatus = useMyStatus((state) => state.status);
  const sharing = useSharing();
  const myUserId = useAuth((state) => state.userId);
  const now = useNow();
  const seers = seersOf(useCircles().data ?? [], sharing, myUserId, now).length;
  const appearance = useMapAppearance((state) => state.mode);
  const effects = useEffectChoice((state) => state.level);
  const plan = usePlan().data;
  const planDetail =
    plan === undefined
      ? undefined
      : plan.plan === 'plus'
        ? t('sheets.me.plusOn')
        : plan.plan === 'trial' && plan.trialEndsAt !== null
          ? t('sheets.me.plusTrial', { days: daysLeft(plan.trialEndsAt, now) })
          : t('sheets.me.plusFree');
  const go = (screen: MeScreen) => {
    leaveSheet('me');
    onClose();
    router.push(screen);
  };
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
    <Sheet
      ref={ref}
      title={t('sheets.me.title')}
      testID="me-sheet"
      onScrolled={(y) => {
        rememberScroll('me', y);
      }}
      scrollTo={() => useSheetReturn.getState().scroll.me ?? 0}
      {...(onDismiss === undefined ? {} : { onDismiss })}
    >
      <Appear style={styles.profile}>
        <Avatar avatar={me.avatar} name={me.displayName ?? '?'} size="lg" userId={me.userId} />
        <View style={styles.profileText}>
          <Text variant="title2">{me.displayName}</Text>
          <Text variant="callout" color="textMuted">{`@${me.username ?? ''}`}</Text>
        </View>
      </Appear>
      <Button
        label={t('sheets.me.editProfile')}
        icon={Pencil}
        variant="secondary"
        onPress={() => {
          go('/edit-profile');
        }}
      />
      <SettingsGroup>
        <SettingsRow
          icon={Smile}
          label={t('sheets.me.status')}
          detail={
            myStatus === null
              ? t('sheets.me.statusNone')
              : [myStatus.emoji, myStatus.text].filter((part) => part !== undefined).join('  ')
          }
          onPress={onStatus}
        />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          testID="me-safe"
          icon={HandHeart}
          label={t('sheets.me.safe')}
          detail={t('sheets.me.safeDetail')}
          onPress={onSafe}
        />
        <SettingsRow
          testID="me-location"
          icon={ShieldHalf}
          label={t('sheets.me.sectionLocation')}
          detail={
            sharing.ghost !== 'off'
              ? t('sheets.me.seersGhost')
              : seers === 0
                ? t('sheets.me.seersNone')
                : t('sheets.me.seersCount', { count: seers })
          }
          onPress={() => {
            go('/settings/location');
          }}
        />
        <SettingsRow
          testID="me-notifications"
          icon={Bell}
          label={t('sheets.me.sectionNotifications')}
          detail={t(`sheets.me.notifications_${push}`)}
          onPress={() => {
            go('/notifications');
          }}
        />
        <SettingsRow
          testID="me-look"
          icon={Palette}
          label={t('sheets.me.sectionLook')}
          detail={t('sheets.me.lookDetail', {
            map: t(`sheets.me.mapAppearance_${appearance}`),
            effects: t(`sheets.me.effects_${effects}`),
          })}
          onPress={() => {
            go('/settings/look');
          }}
        />
        <SettingsRow
          testID="me-security"
          icon={ShieldCheck}
          label={t('sheets.me.sectionSecurity')}
          detail={t('sheets.me.securityDetail')}
          onPress={() => {
            go('/security');
          }}
        />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          icon={Sparkles}
          label={t('sheets.me.plus')}
          detail={planDetail}
          onPress={() => {
            go('/plus');
          }}
        />
        <SettingsRow
          testID="me-account"
          icon={UserCog}
          label={t('sheets.me.privacy')}
          detail={t('sheets.me.privacyDetail')}
          onPress={() => {
            go('/privacy');
          }}
        />
        <SettingsRow
          testID="me-app"
          icon={Info}
          label={t('sheets.me.sectionApp')}
          detail={t('sheets.me.version', { version: env.appVersion })}
          onPress={() => {
            go('/settings/about');
          }}
        />
      </SettingsGroup>
      <Button
        testID="sign-out"
        label={t('sheets.me.logout')}
        icon={LogOut}
        variant="ghost"
        onPress={confirmSignOut}
      />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  profileText: { flex: 1, gap: space.xxs },
});

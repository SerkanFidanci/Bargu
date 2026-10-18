import type { Me } from '@bargu/schemas';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Bell,
  ChevronRight,
  HeartHandshake,
  History,
  KeyRound,
  Map as MapIcon,
  LogOut,
  type LucideIcon,
  Moon,
  Pencil,
  Smile,
  ShieldCheck,
  Smartphone,
  Sparkle,
  Sparkles,
  Sun,
  UserCog,
  Wrench,
} from 'lucide-react-native';
import { Children, forwardRef, Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { DEV_TOOLS_ENABLED, env } from '@/config/env';
import { usePlan } from '@/features/billing/plan';
import { daysLeft } from '@/features/billing/plan-model';
import { useNow } from '@/features/location/clock';
import { signOut } from '@/features/auth/auth-store';
import {
  addPasskey,
  passkeyDiagnostic,
  passkeyFailure,
  passkeysSupported,
} from '@/features/auth/passkeys';
import { errorMessage } from '@/features/errors';
import { GhostControl } from '@/features/location/sharing-card';
import { useSharing } from '@/features/location/sharing';
import { useMyStatus } from '@/features/social/status';
import { startSwarm } from '@/features/dev/map-swarm';
import { useMyFix } from '@/features/location/engine';
import { INITIAL_VIEW } from '@/features/map/style';
import { MAP_APPEARANCES, useMapAppearance } from '@/features/map/appearance';
import { setEffectLevel } from '@/features/home/effect-prefs';
import { usePushState } from '@/features/notifications/push';
import { askForPush } from '@/features/notifications/use-push';
import { meKey } from '@/features/profile/queries';
import { EFFECT_LEVELS, useEffectChoice } from '@/theme/effects';
import { feedback } from '@/theme/haptics';
import { radius, space, touchTarget, useTheme } from '@/theme';
import { Appear } from '@/ui/appear';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { PressableScale } from '@/ui/pressable-scale';
import { Hint } from '@/ui/hint';
import { Segmented } from '@/ui/segmented';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** Licence page of the map data (ODbL), linked from the Me sheet as the credit's permanent home. */
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

export const MeSheet = forwardRef<
  SheetRef,
  { me: Me; onClose: () => void; onStatus: () => void; onDismiss?: () => void }
>(function MeSheet({ me, onClose, onStatus, onDismiss }, ref) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const push = usePushState((state) => state.state);
  const myStatus = useMyStatus((state) => state.status);
  const historyCircles = Object.values(useSharing((state) => state.circles)).filter(
    (sharing) => sharing.history === true,
  ).length;
  const plan = usePlan().data;
  const now = useNow();
  const planDetail =
    plan === undefined
      ? undefined
      : plan.plan === 'plus'
        ? t('sheets.me.plusOn')
        : plan.plan === 'trial' && plan.trialEndsAt !== null
          ? t('sheets.me.plusTrial', { days: daysLeft(plan.trialEndsAt, now) })
          : t('sheets.me.plusFree');
  const appearance = useMapAppearance((state) => state.mode);
  const setAppearance = useMapAppearance((state) => state.setMode);
  const effects = useEffectChoice((state) => state.level);
  const systemReduced = useReducedMotion();
  const createPasskey = async () => {
    try {
      await addPasskey();
      // The count shown here comes from the cache: update it from the result, no refetch.
      queryClient.setQueryData<Me>(meKey, (current) =>
        current === undefined ? current : { ...current, passkeys: current.passkeys + 1 },
      );
      feedback('success');
      toast.success(t('sheets.me.passkeyAdded'));
    } catch (failure) {
      const detail = DEV_TOOLS_ENABLED ? ` (${passkeyDiagnostic(failure)})` : '';
      if (failure instanceof Error) {
        toast.error(errorMessage(failure, t) + detail);
        return;
      }
      const reason = passkeyFailure(failure);
      if (reason === 'exists') toast.info(t('sheets.me.passkeyExists'));
      else if (reason !== 'cancelled') toast.error(t('sheets.me.passkeyFailed') + detail);
    }
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
          onClose();
          router.push('/edit-profile');
        }}
      />
      <Group>
        {passkeysSupported() ? (
          <Row
            icon={KeyRound}
            label={t('sheets.me.passkey')}
            detail={
              me.passkeys > 0
                ? t('sheets.me.passkeyCount', { count: me.passkeys })
                : t('sheets.me.passkeyAdd')
            }
            onPress={() => void createPasskey()}
          />
        ) : null}
        <Row
          icon={Smile}
          label={t('sheets.me.status')}
          detail={
            myStatus === null
              ? t('sheets.me.statusNone')
              : [myStatus.emoji, myStatus.text].filter((part) => part !== undefined).join('  ')
          }
          onPress={onStatus}
        />
      </Group>
      <GhostControl />
      <Group>
        <Row
          icon={History}
          label={t('sheets.me.history')}
          detail={
            historyCircles === 0
              ? t('sheets.me.historyOff')
              : t('sheets.me.historyOn', { count: historyCircles })
          }
          onPress={() => {
            onClose();
            router.push('/history/viewers');
          }}
        />
        <Row
          icon={Bell}
          label={t('sheets.me.notifications')}
          detail={t(`sheets.me.notifications_${push}`)}
          // Once refused, only the system settings can turn them back on.
          onPress={
            push === 'denied'
              ? () => void Linking.openSettings()
              : push === 'undetermined'
                ? () => void askForPush()
                : undefined
          }
        />
      </Group>
      <Segmented
        testID="map-appearance"
        label={t('sheets.me.mapAppearance')}
        value={appearance}
        onChange={setAppearance}
        options={MAP_APPEARANCES.map((value) => ({
          value,
          label: t(`sheets.me.mapAppearance_${value}`),
          icon: APPEARANCE_ICONS[value],
        }))}
      />
      <View style={styles.effects}>
        <Segmented
          testID="effects-level"
          label={t('sheets.me.effects')}
          value={effects}
          onChange={setEffectLevel}
          options={EFFECT_LEVELS.map((value) => ({
            value,
            label: t(`sheets.me.effects_${value}`),
            icon: EFFECT_ICONS[value],
          }))}
        />
        <Hint>
          {systemReduced ? t('sheets.me.effectsSystem') : t(`sheets.me.effectsDetail_${effects}`)}
        </Hint>
      </View>
      <Group>
        <Row
          icon={Sparkles}
          label={t('sheets.me.plus')}
          detail={planDetail}
          onPress={() => {
            onClose();
            router.push('/plus');
          }}
        />
        <Row
          icon={UserCog}
          label={t('sheets.me.privacy')}
          detail={t('sheets.me.privacyDetail')}
          onPress={() => {
            onClose();
            router.push('/privacy');
          }}
        />
        <Row
          icon={HeartHandshake}
          label={t('sheets.me.guardians')}
          detail={t('sheets.me.guardiansDetail')}
          onPress={() => {
            onClose();
            router.push('/guardians');
          }}
        />
        <Row
          icon={ShieldCheck}
          label={t('sheets.me.security')}
          detail={t('sheets.me.securityDetail')}
          onPress={() => {
            onClose();
            router.push('/security');
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
              label={t('dev.swarm.link')}
              onPress={() => {
                onClose();
                const fix = useMyFix.getState().fix;
                const [lng, lat] = INITIAL_VIEW.center;
                startSwarm(fix ?? { lat, lng });
              }}
            />
            <Row
              icon={Wrench}
              label={t('dev.billing.link')}
              onPress={() => {
                onClose();
                router.push('/_dev/billing');
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
        <Row
          icon={MapIcon}
          label={t('sheets.me.mapData')}
          detail={t('sheets.me.mapDataDetail')}
          onPress={() => void Linking.openURL(OSM_COPYRIGHT_URL)}
        />
      </Group>
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

const APPEARANCE_ICONS = { auto: MapIcon, light: Sun, dark: Moon } as const;
const EFFECT_ICONS = { full: Sparkles, reduced: Sparkle, off: Ban } as const;

/** Rows that belong together on one card, a hairline between them (the theme of 2026-10-18). */
function Group({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index === 0 ? null : (
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          )}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

function Row({
  icon: Icon,
  label,
  detail,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string | undefined;
  onPress?: (() => void) | undefined;
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
      {onPress === undefined ? null : (
        <ChevronRight color={colors.textMuted} size={20} strokeWidth={2.25} />
      )}
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
  effects: { gap: space.sm },
  profileText: { flex: 1, gap: space.xxs },
  group: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space.md,
  },
  divider: { height: StyleSheet.hairlineWidth * 2, marginLeft: touchTarget + space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touchTarget + space.md,
  },
  rowIcon: {
    width: touchTarget - space.sm,
    height: touchTarget - space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: space.xxs },
});

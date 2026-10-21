import type { Me } from '@bargu/schemas';
import { useBatteryLevel, useBatteryState, BatteryState } from 'expo-battery';
import { router } from 'expo-router';
import {
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
  Eye,
  History,
  Settings,
  Smile,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { ActionTile } from '@/ui/action-tile';
import { Text } from '@/ui/text';

import { useCircles } from '../circles/queries';
import { sharingNow } from '../home/seers-pill';
import { useNow } from '../location/clock';
import { useMyFix } from '../location/engine';
import { seersOf, useSharing } from '../location/sharing';
import { GhostControl } from '../location/sharing-card';
import { useLocationPermission } from '../location/tracker';
import { sinceTime, useMyWhy } from '../location/why';
import { useMyStatus } from '../social/status';
import { LOW_BATTERY, staleMinutes } from './people-layer';
import { CardFrame, Fact, WHY_ICONS } from './person-card';
import { closeCard, type ScreenPoint } from './person-focus';

/**
 * The user's own card, from a tap on their own pin as on anyone's (the owner, 2026-10-21): who
 * their location goes to now, the ghost, their status and their phone's battery; and the way to
 * who sees them, their status, their history and the location settings. Nothing that makes no
 * sense for oneself (no poke, no meeting).
 */
export function MyCard({
  me,
  from,
  onHeight,
  onStatus,
}: {
  me: Me;
  from: ScreenPoint;
  onHeight: (height: number) => void;
  onStatus: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const sendingWhy = useMyWhy((state) => state.current);
  const sharing = useSharing();
  const fix = useMyFix((state) => state.fix);
  const status = useMyStatus((state) => state.status);
  const permission = useLocationPermission((state) => state.state);
  const seers = seersOf(useCircles().data ?? [], sharing, me.userId, now).length;
  // What the location is doing now, worked out as the pill on the map works it out (sharingNow):
  // a count of "who sees you" with no permission, or before it is known, would say what is not so
  // (QA 27 B-1, a sibling of QA 24 B-1).
  const going = sharingNow({ ghost: sharing.ghost, seers, permission });
  const seersText =
    going === 'hidden' || going === 'frozen'
      ? t('map.myCard.ghost')
      : going === 'nobody'
        ? t('map.myCard.nobody')
        : going === 'shared'
          ? t('map.myCard.seers', { count: seers })
          : t(`main.seers.now.${going}`);
  const level = Math.round(useBatteryLevel() * 100);
  const charging = useBatteryState() === BatteryState.CHARGING;
  const minutes = fix === null ? undefined : staleMinutes(fix.ts, now);
  const when =
    fix === null
      ? t('map.myCard.noLocation')
      : minutes === undefined
        ? t('map.card.now')
        : minutes < 60
          ? t('map.card.minutesAgo', { minutes })
          : t('map.card.hoursAgo', { hours: Math.floor(minutes / 60) });
  const go = (screen: '/seers' | '/history/viewers' | '/settings/location') => {
    closeCard();
    router.push(screen);
  };
  const live = status !== null && status.expiresAt > now ? status : null;
  return (
    <CardFrame
      testID="my-card"
      from={from}
      onHeight={onHeight}
      avatar={{ avatar: me.avatar, name: me.displayName ?? '?', userId: me.userId }}
      title={me.displayName ?? '?'}
      subtitle={[t('map.myCard.you'), when].join(' · ')}
    >
      {live === null ? null : (
        <View style={[styles.status, { backgroundColor: colors.surface }]}>
          <Text variant="bodyStrong">
            {[live.emoji, live.text].filter((part) => part !== undefined).join('  ')}
          </Text>
        </View>
      )}
      <View style={styles.facts}>
        <Fact icon={Eye} text={seersText} />
        {/* What the circles are told about why the location is old, while one is being told. */}
        {sendingWhy === null ? null : (
          <Fact
            testID="my-why"
            icon={WHY_ICONS[sendingWhy.why]}
            text={t('map.myCard.seenAs', {
              what: t('map.card.whySince', {
                why: t(`ui.marker.why.${sendingWhy.why}`),
                time: sinceTime(sendingWhy.since, i18n.language),
              }),
            })}
          />
        )}
        {/* The battery as this phone reads it (−1 where it cannot: then not said). */}
        {level < 0 ? null : (
          <Fact
            icon={charging ? BatteryCharging : level < LOW_BATTERY ? BatteryLow : BatteryMedium}
            text={
              charging ? t('map.card.batteryCharging', { level }) : t('map.card.battery', { level })
            }
            danger={!charging && level < LOW_BATTERY}
          />
        )}
      </View>
      <GhostControl />
      <View style={styles.actions}>
        <ActionTile
          testID="my-seers"
          label={t('map.myCard.whoSees')}
          icon={Eye}
          primary
          onPress={() => {
            go('/seers');
          }}
        />
        <ActionTile
          testID="my-status"
          label={t('map.myCard.status')}
          icon={Smile}
          onPress={() => {
            closeCard();
            onStatus();
          }}
        />
        <ActionTile
          testID="my-history"
          label={t('map.actions.history')}
          icon={History}
          onPress={() => {
            go('/history/viewers');
          }}
        />
        <ActionTile
          testID="my-settings"
          label={t('map.myCard.settings')}
          icon={Settings}
          onPress={() => {
            go('/settings/location');
          }}
        />
      </View>
    </CardFrame>
  );
}

const styles = StyleSheet.create({
  facts: { gap: space.sm },
  status: { padding: space.md, borderRadius: radius.lg, gap: space.xxs },
  actions: { flexDirection: 'row', gap: space.sm },
});

import {
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
  Bell,
  BellOff,
  Flag,
  Hand,
  History,
  type LucideIcon,
  MapPin,
  Navigation,
  UserRound,
  Users,
  X,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { avatarSize, elevation, radius, space, spring, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Avatar } from '@/ui/avatar';
import { ActionTile } from '@/ui/action-tile';
import { IconButton } from '@/ui/icon-button';
import { Text } from '@/ui/text';

import { useNow } from '../location/clock';
import { loadMuteSettings } from '../notifications/mute-session';
import { personMutes, useMutes } from '../notifications/mutes';
import { statusOf, useStatuses } from '../social/status';
import { useMyFix } from '../location/engine';
import { distanceBetween } from './glide';
import { LOW_BATTERY, staleMinutes } from './people-layer';
import { circleActionLabel, type PersonView } from './person-actions';
import { closeCard, type PersonAction, type ScreenPoint } from './person-focus';
import { distanceText } from './distance-text';

/** Dragging the card down this far (px) closes it. */
const DISMISS_PX = space.xxxl * 2;
/** A location this coarse (m) came from a circle that shares only the neighbourhood or city. */
const COARSE_M = 500;
const HEADER = avatarSize.lg;
const MARKER = avatarSize.md;

function useBackToClose(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeCard();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [open]);
}

/**
 * A person's card (BARGU_PLAN §4.3 "Kişi Sheet'i"): how long ago, where (place name read from the
 * map on the phone), how far, battery, and the same actions as the radial menu: their notifications
 * too, by the bell, which shows when they are silenced (UX düzeni 1). Opening it, their avatar flies
 * from the map into the card (a shared-element transition on the UI thread); the ×, a drag down, a
 * tap on the map or back closes it.
 */
export function PersonCard({
  person,
  from,
  place,
  onAction,
  onHeight,
}: {
  person: PersonView;
  /** Where on screen their avatar was tapped. */
  from: ScreenPoint;
  /** Place name, once the map has it (null: none nearby, undefined: still looking). */
  place: string | null | undefined;
  onAction: (action: PersonAction | 'meet') => void;
  /** The card's height, so the map keeps the person visible above it. */
  onHeight: (height: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const myFix = useMyFix((state) => state.fix);
  const motion = useMotion();
  const [landed, setLanded] = useState(false);
  const started = useRef(false);
  const drag = useSharedValue(0);
  const flyX = useSharedValue(0);
  const flyY = useSharedValue(0);
  const flyScale = useSharedValue(1);
  const flyShown = useSharedValue(0);
  useBackToClose(true);

  const loc = person.location?.loc ?? null;
  loadMuteSettings();
  const silenced = personMutes(useMutes(), person.userId);
  const quiet = silenced.places || silenced.pokes;
  const circleLabel = circleActionLabel(person);
  const status = statusOf(useStatuses(), person.userId, now);
  const minutes = loc === null ? undefined : staleMinutes(loc.ts, now);

  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    onHeight(height);
    if (started.current) return;
    started.current = true;
    // The header avatar's centre on screen, from the card's own layout (no transforms involved).
    const to = { x: space.xl + HEADER / 2, y: y + space.xl + HEADER / 2 };
    const config = { ...spring.snappy, reduceMotion: ReduceMotion.System };
    flyX.set(from.x - to.x);
    flyY.set(from.y - to.y);
    flyScale.set(MARKER / HEADER);
    flyShown.set(1);
    flyX.set(withSpring(0, config));
    flyY.set(withSpring(0, config));
    flyScale.set(
      withSpring(1, config, (finished) => {
        if (finished === true) scheduleOnRN(setLanded, true);
      }),
    );
  };

  const flying = useAnimatedStyle(() => ({
    opacity: flyShown.get(),
    transform: [{ translateX: flyX.get() }, { translateY: flyY.get() }, { scale: flyScale.get() }],
  }));
  const card = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, drag.get()) }] }));

  const pan = Gesture.Pan()
    .activeOffsetY(space.sm)
    .onUpdate((event) => {
      drag.set(event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > DISMISS_PX) {
        scheduleOnRN(closeCard);
        return;
      }
      drag.set(withSpring(0, spring.snappy));
    });

  const when =
    loc === null
      ? t('map.card.noLocation')
      : minutes === undefined
        ? t('map.card.now')
        : minutes < 60
          ? t('map.card.minutesAgo', { minutes })
          : t('map.card.hoursAgo', { hours: Math.floor(minutes / 60) });
  const far =
    loc === null || myFix === null
      ? null
      : distanceText(distanceBetween(myFix, loc), i18n.language);
  const BatteryIcon =
    loc?.chg === true
      ? BatteryCharging
      : (loc?.bat ?? 100) < LOW_BATTERY
        ? BatteryLow
        : BatteryMedium;

  return (
    <Animated.View entering={motion.enterUp} onLayout={onLayout} style={styles.dock}>
      <GestureDetector gesture={pan}>
        <Animated.View
          testID="person-card"
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceRaised,
              boxShadow: elevation.floating,
              paddingBottom: insets.bottom + space.lg,
            },
            card,
          ]}
        >
          <View style={styles.header}>
            <Animated.View style={[styles.avatar, flying, landed ? null : styles.inFlight]}>
              <Avatar avatar={person.avatar} name={person.name} size="lg" userId={person.userId} />
            </Animated.View>
            <View style={styles.titles}>
              <Text variant="title2" numberOfLines={1}>
                {person.name}
              </Text>
              <Text variant="footnote" color="textMuted">
                {[person.handle, when, quiet ? t('map.card.muted') : undefined]
                  .filter((part) => part !== undefined)
                  .join(' · ')}
              </Text>
            </View>
            <IconButton
              testID="card-notifications"
              icon={quiet ? BellOff : Bell}
              tone="plain"
              label={
                quiet
                  ? t('map.card.notificationsMuted', { name: person.name })
                  : t('map.card.notifications', { name: person.name })
              }
              onPress={() => {
                onAction('notifications');
              }}
            />
            <IconButton
              testID="card-close"
              icon={X}
              tone="plain"
              label={t('map.card.close')}
              onPress={closeCard}
            />
          </View>
          {status === null ? null : (
            <View style={[styles.status, { backgroundColor: colors.surface }]}>
              <Text variant="bodyStrong">
                {[status.emoji, status.text].filter((part) => part !== undefined).join('  ')}
              </Text>
              <Text variant="caption" color="textMuted">
                {t('map.card.statusLeft', {
                  hours: Math.max(1, Math.round((status.expiresAt - now) / 3_600_000)),
                })}
              </Text>
            </View>
          )}
          {loc === null ? null : (
            <View style={styles.facts}>
              <Fact
                icon={MapPin}
                text={place ?? (place === null ? t('map.card.placeUnknown') : '…')}
              />
              {far === null ? null : (
                <Fact icon={Navigation} text={t('map.card.distance', { far })} />
              )}
              <Fact
                icon={BatteryIcon}
                text={
                  loc.chg
                    ? t('map.card.batteryCharging', { level: loc.bat })
                    : t('map.card.battery', { level: loc.bat })
                }
                danger={!loc.chg && loc.bat < LOW_BATTERY}
              />
              {loc.acc >= COARSE_M ? (
                <Fact icon={MapPin} text={t('map.card.coarse')} muted />
              ) : null}
            </View>
          )}
          <View style={styles.actions}>
            <ActionTile
              testID="card-poke"
              label={t('map.actions.poke')}
              icon={Hand}
              primary
              onPress={() => {
                onAction('poke');
              }}
            />
            <ActionTile
              testID="card-meet"
              label={t('map.actions.meet')}
              icon={Flag}
              disabled={person.username === null}
              onPress={() => {
                onAction('meet');
              }}
            />
            <ActionTile
              testID="card-directions"
              label={t('map.actions.directions')}
              icon={Navigation}
              disabled={loc === null}
              onPress={() => {
                onAction('directions');
              }}
            />
            <ActionTile
              testID="card-history"
              label={t('map.actions.history')}
              icon={History}
              onPress={() => {
                onAction('history');
              }}
            />
            <ActionTile
              testID="card-profile"
              label={t(`map.actions.${circleLabel}`)}
              icon={circleLabel === 'friendship' ? UserRound : Users}
              onPress={() => {
                onAction('profile');
              }}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function Fact({
  icon: Icon,
  text,
  danger = false,
  muted = false,
}: {
  icon: LucideIcon;
  text: string;
  danger?: boolean;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  const color = danger ? colors.danger : colors.textMuted;
  return (
    <View style={styles.fact}>
      <Icon color={color} size={18} strokeWidth={2.25} />
      <Text
        variant="callout"
        color={muted || danger ? 'textMuted' : 'text'}
        style={styles.factText}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  card: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl,
    gap: space.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: HEADER },
  avatar: { width: HEADER, height: HEADER },
  inFlight: { zIndex: 1 },
  titles: { flex: 1, gap: space.xxs },
  facts: { gap: space.sm },
  status: { padding: space.md, borderRadius: radius.lg, gap: space.xxs },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  factText: { flex: 1 },
  actions: { flexDirection: 'row', gap: space.sm },
});

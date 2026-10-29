import {
  Aperture,
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bell,
  BellOff,
  ChevronUp,
  Ellipsis,
  Flag,
  Hand,
  History,
  House,
  LocateOff,
  type LucideIcon,
  MapPin,
  MapPinOff,
  MessageCircle,
  Navigation,
  TriangleAlert,
  UserRound,
  Users,
  UserX,
  WifiOff,
  X,
} from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
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

import type { Avatar as AvatarData } from '@bargu/schemas';

import { avatarSize, elevation, radius, space, spring, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Avatar } from '@/ui/avatar';
import { ActionTile } from '@/ui/action-tile';
import type { MarkerWhy } from '@/ui/avatar-marker';
import { Appear } from '@/ui/appear';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { useNow } from '../location/clock';
import { useAuth } from '../auth/auth-store';
import { storiesOf, useMessages } from '../messages/messages';
import { StoryRing } from '../messages/story-avatar';
import { loadMuteSettings } from '../notifications/mute-session';
import { personMutes, useMutes } from '../notifications/mutes';
import { statusOf, useStatuses } from '../social/status';
import { useMyFix } from '../location/engine';
import { clockOf, personShareOf } from '../location/person-share';
import { useSharing } from '../location/sharing';
import { newestState, sinceTime, useStates, whyShown } from '../location/why';
import { distanceBetween } from './glide';
import { LOW_BATTERY, staleMinutes } from './people-layer';
import { circleActionLabel, type PersonView } from './person-actions';
import { closeCard, type PersonAction, type ScreenPoint } from './person-focus';
import { distanceText } from './distance-text';
import { homeEta } from './home-eta';
import type { Place } from '../places/place-model';

/** Dragging the card down this far (px) closes it. */
const DISMISS_PX = space.xxxl * 2;
/** A location this coarse (m) came from a circle that shares only the neighbourhood or city. */
const COARSE_M = 500;
const HEADER = avatarSize.lg;
/** The icon beside why an old location is old (features/location/why.ts). */
export const WHY_ICONS: Record<MarkerWhy, LucideIcon> = {
  saver: BatteryWarning,
  permission: MapPinOff,
  nofix: LocateOff,
  offline: WifiOff,
};
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
 * What every card on the map shares (a friend's, and since the owner's request of 2026-10-21 the
 * user's own): the avatar flying in from the map, the name and a line under it, buttons beside the
 * name, the ×, and closing by a drag down, a tap on the map or back.
 */
export function CardFrame({
  testID,
  from,
  onHeight,
  avatar,
  title,
  subtitle,
  buttons,
  story,
  children,
}: {
  testID: string;
  /** Where on screen the avatar was tapped. */
  from: ScreenPoint;
  /** The card's height, so the map keeps the person visible above it. */
  onHeight: (height: number) => void;
  avatar: { avatar: AvatarData | null; name: string; userId: string };
  title: string;
  subtitle: string;
  /** Beside the name, before the ×. */
  buttons?: ReactNode;
  /** Their story (docs/ADR/0035 §8): the ring around the avatar, which opens it. */
  story?: { seen: boolean; label: string; onPress: () => void } | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const motion = useMotion();
  const [landed, setLanded] = useState(false);
  const started = useRef(false);
  const drag = useSharedValue(0);
  const flyX = useSharedValue(0);
  const flyY = useSharedValue(0);
  const flyScale = useSharedValue(1);
  const flyShown = useSharedValue(0);
  useBackToClose(true);

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

  return (
    <Animated.View entering={motion.enterUp} onLayout={onLayout} style={styles.dock}>
      <GestureDetector gesture={pan}>
        <Animated.View
          testID={testID}
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
              {story === undefined ? (
                <Avatar
                  avatar={avatar.avatar}
                  name={avatar.name}
                  size="lg"
                  userId={avatar.userId}
                />
              ) : (
                <PressableScale
                  testID="card-avatar-story"
                  haptic="select"
                  accessibilityRole="button"
                  accessibilityLabel={story.label}
                  onPress={story.onPress}
                >
                  <StoryRing inner={HEADER} seen={story.seen} />
                  <Avatar
                    avatar={avatar.avatar}
                    name={avatar.name}
                    size="lg"
                    userId={avatar.userId}
                  />
                </PressableScale>
              )}
            </Animated.View>
            <View style={styles.titles}>
              <Text variant="title2" numberOfLines={1}>
                {title}
              </Text>
              <Text variant="footnote" color="textMuted">
                {subtitle}
              </Text>
            </View>
            {buttons}
            <IconButton
              testID="card-close"
              icon={X}
              tone="plain"
              label={t('map.card.close')}
              onPress={closeCard}
            />
          </View>
          {children}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/**
 * A person's card (BARGU_PLAN §4.3 "Kişi Sheet'i"): how long ago, where (place name read from the
 * map on the phone), how far, battery. Three things up front, "Mesaj", "Dürt" and "Yol tarifi"; the
 * rest under "Daha fazla" (the PM report T3, 2026-10-29: eight actions crowded a narrow card): their
 * story, a meeting, their history, their notifications (also saying when they are silenced, UX
 * düzeni 1) and the circle. Opening it, their avatar flies from the map into the card (a
 * shared-element transition on the UI thread); the ×, a drag down, a tap on the map or back closes
 * it.
 */
export function PersonCard({
  person,
  from,
  place,
  onAction,
  onHeight,
  canMessage,
  homes = [],
}: {
  person: PersonView;
  /** Where on screen their avatar was tapped. */
  from: ScreenPoint;
  /** Place name, once the map has it (null: none nearby, undefined: still looking). */
  place: string | null | undefined;
  onAction: (
    action: PersonAction | 'meet' | 'message' | 'story' | 'report' | 'block' | 'sharing',
  ) => void;
  /** The card's height, so the map keeps the person visible above it. */
  onHeight: (height: number) => void;
  /**
   * A lasting circle is shared, so they can be written to alone: someone met only at an event is
   * written to in the event's conversation (docs/ADR/0035 §1, QA-38 O2).
   */
  canMessage: boolean;
  /** Homes of the circles shared with them: "Eve yaklaşık 12 dk" while on their way (Ö12). */
  homes?: readonly Place[];
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const [more, setMore] = useState(false);
  const myFix = useMyFix((state) => state.fix);
  const loc = person.location?.loc ?? null;
  loadMuteSettings();
  const silenced = personMutes(useMutes(), person.userId);
  const quiet = silenced.places || silenced.pokes || silenced.messages;
  const circleLabel = circleActionLabel(person);
  const sharing = useSharing();
  const share =
    person.circleKind === 'pair' && person.circleId !== null
      ? personShareOf(sharing, person.circleId, now)
      : null;
  const sharingLine =
    share === null
      ? t('location.personShare.byCircle')
      : sharing.ghost !== 'off'
        ? t('location.personShare.lineGhost')
        : share.mode === 'until' && share.until !== null
          ? t('location.personShare.untilTime', { time: clockOf(share.until, i18n.language) })
          : share.mode === 'frozen'
            ? t('location.personShare.line.frozen')
            : share.mode === 'off'
              ? t('location.personShare.line.off')
              : t('location.personShare.line.always');
  // Their stories (docs/ADR/0035 §8): the same ring as on the pin, around their face, opens them.
  const me = useAuth((state) => state.userId);
  const storyState = useMessages((state) => {
    const theirs = storiesOf(state, me).find((each) => each.userId === person.userId);
    return theirs === undefined ? 'none' : theirs.unseen ? 'new' : 'seen';
  });
  const hasStory = storyState !== 'none';
  const status = statusOf(useStatuses(), person.userId, now);
  const minutes = loc === null ? undefined : staleMinutes(loc.ts, now);
  const home = loc === null ? null : homeEta(loc, homes, now);
  const states = useStates();
  const why =
    loc === null ? null : whyShown({ loc, state: newestState(states, person.userId), now });

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
    <CardFrame
      testID="person-card"
      from={from}
      onHeight={onHeight}
      avatar={{ avatar: person.avatar, name: person.name, userId: person.userId }}
      title={person.name}
      story={
        hasStory
          ? {
              seen: storyState === 'seen',
              label: t('messages.story.openOf', { name: person.name }),
              onPress: () => {
                onAction('story');
              },
            }
          : undefined
      }
      subtitle={[person.handle, when, quiet ? t('map.card.muted') : undefined]
        .filter((part) => part !== undefined)
        .join(' · ')}
    >
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
          {why === null ? null : (
            <Fact
              testID="card-why"
              icon={WHY_ICONS[why.kind]}
              text={t('map.card.whySince', {
                why: t(`ui.marker.why.${why.kind}`),
                time: sinceTime(why.since, i18n.language),
              })}
            />
          )}
          <Fact icon={MapPin} text={place ?? (place === null ? t('map.card.placeUnknown') : '…')} />
          {far === null ? null : <Fact icon={Navigation} text={t('map.card.distance', { far })} />}
          {home === null ? null : (
            <Fact
              testID="card-home-eta"
              icon={House}
              text={t('map.card.homeEta', {
                place: `${home.place.emoji} ${home.place.name}`,
                minutes: home.minutes,
              })}
            />
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
          {loc.acc >= COARSE_M ? <Fact icon={MapPin} text={t('map.card.coarse')} muted /> : null}
        </View>
      )}
      <View style={styles.actions}>
        {/* Messages and moments (docs/ADR/0035): their own conversation. */}
        {canMessage ? (
          <ActionTile
            testID="card-message"
            label={t('map.actions.message')}
            icon={MessageCircle}
            onPress={() => {
              onAction('message');
            }}
          />
        ) : null}
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
          testID="card-directions"
          label={t('map.actions.directions')}
          icon={Navigation}
          disabled={loc === null}
          onPress={() => {
            onAction('directions');
          }}
        />
        <ActionTile
          testID="card-more"
          label={more ? t('map.actions.less') : t('map.actions.more')}
          icon={more ? ChevronUp : Ellipsis}
          onPress={() => {
            setMore(!more);
          }}
        />
      </View>
      {more ? (
        <View testID="card-more-list">
          {[
            hasStory
              ? {
                  key: 'story',
                  icon: Aperture,
                  title: t('messages.story.openOf', { name: person.name }),
                  action: 'story' as const,
                }
              : null,
            person.username === null
              ? null
              : {
                  key: 'meet',
                  icon: Flag,
                  title: t('map.actions.meetLong'),
                  action: 'meet' as const,
                },
            {
              key: 'history',
              icon: History,
              title: t('map.actions.history'),
              action: 'history' as const,
            },
            // What they get of the location (docs/ADR/0038): a friend's own, or the group's.
            {
              key: 'sharing',
              icon: MapPin,
              title: t('location.personShare.row'),
              subtitle: sharingLine,
              action: 'sharing' as const,
            },
            {
              key: 'notifications',
              icon: quiet ? BellOff : Bell,
              title: quiet
                ? t('map.card.notificationsMuted', { name: person.name })
                : t('map.card.notifications', { name: person.name }),
              action: 'notifications' as const,
            },
            {
              key: 'profile',
              icon: circleLabel === 'friendship' ? UserRound : Users,
              title: t(`map.actions.${circleLabel}`),
              action: 'profile' as const,
            },
            // "Bildir" and "Engelle" on every person's card (docs/ADR/0035 §9, QA-40 O2): also for
            // someone met only at an event, who has no conversation of their own.
            {
              key: 'report',
              icon: TriangleAlert,
              title: t('messages.report'),
              action: 'report' as const,
            },
            { key: 'block', icon: UserX, title: t('messages.block'), action: 'block' as const },
          ]
            .filter((row) => row !== null)
            .map((row, index) => (
              <Appear key={row.key} index={index}>
                <ListRow
                  testID={`card-${row.key}`}
                  leading={<RowIcon icon={row.icon} />}
                  title={row.title}
                  subtitle={'subtitle' in row ? row.subtitle : undefined}
                  onPress={() => {
                    onAction(row.action);
                  }}
                />
              </Appear>
            ))}
        </View>
      ) : null}
    </CardFrame>
  );
}

/** The icon of a row under "Daha fazla". */
function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
      <Icon color={colors.primary} size={20} strokeWidth={2.25} />
    </View>
  );
}

/** One line of facts on a card: an icon and a short text. */
export function Fact({
  testID,
  icon: Icon,
  text,
  danger = false,
  muted = false,
}: {
  testID?: string;
  icon: LucideIcon;
  text: string;
  danger?: boolean;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  const color = danger ? colors.danger : colors.textMuted;
  return (
    <View testID={testID} style={styles.fact}>
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
  rowIcon: {
    width: avatarSize.md,
    height: avatarSize.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

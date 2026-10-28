import type { Me } from '@bargu/schemas';
import { MessageCircle, Plus, Users } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { choreography, elevation, radius, space, spring, touchTarget, useTheme } from '@/theme';
import { useGlow } from '@/theme/effects';
import { useMotion } from '@/theme/use-motion';
import { Avatar } from '@/ui/avatar';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

export interface DockProps {
  me: Me;
  onCircles: () => void;
  onAdd: () => void;
  onMe: () => void;
  /** Messages and moments (docs/ADR/0035): its screen, and how many items wait unread. */
  onMessages: () => void;
  unread: number;
  /** The add sheet is open: the + turns into a close cross. */
  addOpen: boolean;
  /** Invitations waiting for an answer, shown as a badge on Circles. */
  requests: number;
  /** Where the user is: the circles (the map, or their sheet) or Me (the theme of 2026-10-18). */
  active: 'circles' | 'me';
}

/**
 * The bar at the bottom of the map: Circles · Messages · Add · Me (BARGU_PLAN §4.3; Messages since
 * docs/ADR/0035). The + stands exactly in the middle (the owner, 2026-10-28): two halves of equal
 * width, Circles and Messages in the left one, Me in the right one.
 */
export function Dock({
  me,
  onCircles,
  onAdd,
  onMe,
  onMessages,
  unread,
  addOpen,
  requests,
  active,
}: DockProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const glow = useGlow();
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withSpring(addOpen ? choreography.addTurn : 0, spring.bouncy));
  }, [addOpen, turn]);
  const turned = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(turn.get())}deg` }] }));
  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.border,
          boxShadow: elevation.floating,
        },
      ]}
    >
      <View style={styles.half}>
        <DockItem
          label={t('main.dock.circles')}
          accessibilityLabel={
            requests > 0
              ? t('main.dock.circlesWithRequests', { count: requests })
              : t('main.dock.circles')
          }
          onPress={onCircles}
          testID="dock-circles"
          active={active === 'circles'}
        >
          <View>
            <Users
              color={active === 'circles' ? colors.primary : colors.text}
              size={24}
              strokeWidth={2.25}
            />
            {requests > 0 ? <RequestBadge count={requests} /> : null}
          </View>
        </DockItem>
        <DockItem
          label={t('messages.dock')}
          accessibilityLabel={
            unread > 0 ? t('messages.dockUnread', { count: unread }) : t('messages.dock')
          }
          onPress={onMessages}
          testID="dock-messages"
          active={false}
        >
          <View>
            <MessageCircle color={colors.text} size={24} strokeWidth={2.25} />
            {unread > 0 ? <RequestBadge count={unread} /> : null}
          </View>
        </DockItem>
      </View>
      <Animated.View style={[turned, styles.add, glow === undefined ? null : { boxShadow: glow }]}>
        <IconButton
          testID="dock-add"
          icon={Plus}
          label={addOpen ? t('ui.sheet.close') : t('main.dock.add')}
          tone="primary"
          size={touchTarget + space.md}
          onPress={onAdd}
        />
      </Animated.View>
      <View style={styles.half}>
        <DockItem
          label={t('main.dock.me')}
          onPress={onMe}
          testID="dock-me"
          active={active === 'me'}
        >
          <Avatar avatar={me.avatar} name={me.displayName ?? '?'} size="sm" userId={me.userId} />
        </DockItem>
      </View>
    </View>
  );
}

/** A small count over the Circles icon; pops in when a new invitation arrives. */
function RequestBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  const motion = useMotion();
  return (
    <Animated.View
      key={count}
      entering={motion.pop}
      style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.surfaceRaised }]}
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant="caption" color="onAccent" allowFontScaling={false}>
        {count > 9 ? '9+' : String(count)}
      </Text>
    </Animated.View>
  );
}

function DockItem({
  label,
  accessibilityLabel,
  onPress,
  children,
  testID,
  active,
}: {
  label: string;
  active: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      haptic="select"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      style={styles.item}
    >
      {children}
      <Text
        variant="caption"
        maxFontSizeMultiplier={1.3}
        style={{ color: active ? colors.primary : colors.textMuted }}
      >
        {label}
      </Text>
      <View
        style={[styles.underline, { backgroundColor: active ? colors.primary : 'transparent' }]}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    marginHorizontal: space.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  /** Each side of the +: as wide as the other, so the + is in the middle whatever they hold. */
  half: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  underline: { width: space.xl, height: space.xs - 1, borderRadius: radius.pill },
  add: { borderRadius: radius.pill },
  badge: {
    position: 'absolute',
    top: -space.xs,
    right: -space.md,
    minWidth: space.lg + space.xs,
    height: space.lg + space.xs,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    minWidth: touchTarget + space.xl,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
});

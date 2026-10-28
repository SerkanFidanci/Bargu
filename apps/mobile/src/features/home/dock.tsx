import type { Me } from '@bargu/schemas';
import { MessageCircle, Plus, ShoppingBag, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { choreography, dockShape, radius, space, spring, touchTarget, useTheme } from '@/theme';
import { useEffects, useGlow } from '@/theme/effects';
import { useMotion } from '@/theme/use-motion';
import { Avatar } from '@/ui/avatar';
import { brandStops } from '@/ui/brand-fill';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { DOCK_RISE, dockOutline } from './dock-shape';

export interface DockProps {
  me: Me;
  onCircles: () => void;
  onAdd: () => void;
  onMe: () => void;
  /** Messages and moments (docs/ADR/0035): its screen, and how many items wait unread. */
  onMessages: () => void;
  /** The store (docs/ADR/0025 Ek 2): the pin looks and Bargu+. */
  onStore: () => void;
  unread: number;
  /** The add sheet is open: the + turns into a close cross. */
  addOpen: boolean;
  /** Invitations waiting for an answer, shown as a badge on Circles. */
  requests: number;
  /** Where the user is: the circles (the map, or their sheet) or Me (the theme of 2026-10-18). */
  active: 'circles' | 'me';
}

/**
 * The bar at the bottom of the map, as the owner drew it (2026-10-28): Circles · Messages · + ·
 * Store · Me in five equal columns, the + raised on a smooth hump above the middle one
 * (dock-shape.ts), so it stands exactly in the middle.
 */
export function Dock({
  me,
  onCircles,
  onAdd,
  onMe,
  onMessages,
  onStore,
  unread,
  addOpen,
  requests,
  active,
}: DockProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const glow = useGlow();
  const turn = useSharedValue(0);
  // Sade mod "Kapalı": the + is turned at once, no spring (QA-39).
  const still = useEffects() === 'off';
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const to = addOpen ? choreography.addTurn : 0;
    turn.set(still ? to : withSpring(to, spring.bouncy));
  }, [addOpen, turn, still]);
  const turned = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(turn.get())}deg` }] }));
  const outline = size === null ? null : dockOutline(size.width, size.height);
  // The hump is inside this view (a strip as tall as it above the bar), so the whole + takes taps:
  // Android gives a view no touch outside its own bounds.
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {outline === null || size === null ? null : (
        <Svg
          pointerEvents="none"
          style={styles.shape}
          width={size.width}
          height={size.height + outline.rise}
        >
          <Path
            d={outline.path}
            fill={colors.surfaceRaised}
            stroke={colors.border}
            strokeWidth={StyleSheet.hairlineWidth * 2}
          />
        </Svg>
      )}
      <View
        style={styles.dock}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize((current) =>
            current?.width === width && current.height === height ? current : { width, height },
          );
        }}
      >
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
        {/* The middle column: the + stands above it, on the hump. */}
        <View style={styles.slot} />
        <DockItem label={t('main.dock.store')} onPress={onStore} testID="dock-store" active={false}>
          <ShoppingBag color={colors.text} size={24} strokeWidth={2.25} />
        </DockItem>
        <DockItem
          label={t('main.dock.me')}
          onPress={onMe}
          testID="dock-me"
          active={active === 'me'}
        >
          <Avatar avatar={me.avatar} name={me.displayName ?? '?'} size="sm" userId={me.userId} />
        </DockItem>
      </View>
      <View style={styles.addPlace} pointerEvents="box-none">
        <Animated.View
          style={[turned, styles.add, glow === undefined ? null : { boxShadow: glow }]}
        >
          <AddButton label={addOpen ? t('ui.sheet.close') : t('main.dock.add')} onPress={onAdd} />
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * The raised +: the brand's sweep (the owner, 2026-10-29: "Lacivert turuncu renk geçişleri"), lit
 * from its upper left, as in the owner's picture.
 */
function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const half = dockShape.add / 2;
  return (
    <PressableScale
      testID="dock-add"
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.addButton, { backgroundColor: colors.brandGradient[0] }]}
    >
      <Svg style={StyleSheet.absoluteFill} width={dockShape.add} height={dockShape.add}>
        <Defs>
          <LinearGradient id="dock-add-brand" x1="0" y1="0" x2="1" y2="1">
            {brandStops(colors.brandGradient)}
          </LinearGradient>
          <LinearGradient id="dock-add-light" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.onBrand} stopOpacity={0.32} />
            <Stop offset="0.6" stopColor={colors.onBrand} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Circle cx={half} cy={half} r={half} fill="url(#dock-add-brand)" />
        <Circle cx={half} cy={half} r={half} fill="url(#dock-add-light)" />
      </Svg>
      <Plus color={colors.onBrand} size={touchTarget * 0.6} strokeWidth={2.5} />
    </PressableScale>
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
        numberOfLines={1}
        adjustsFontSizeToFit
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
  wrap: { paddingTop: DOCK_RISE, marginHorizontal: space.sm },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  shape: { position: 'absolute', left: 0, top: 0 },
  /** Five equal columns: the + is in the middle one, so exactly in the middle of the bar. */
  item: {
    flex: 1,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  slot: { flex: 1 },
  addPlace: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: DOCK_RISE + dockShape.drop - dockShape.add / 2,
    alignItems: 'center',
  },
  add: { borderRadius: radius.pill },
  addButton: {
    width: dockShape.add,
    height: dockShape.add,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  underline: { width: space.xl, height: space.xs - 1, borderRadius: radius.pill },
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
});

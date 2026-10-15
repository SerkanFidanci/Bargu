import { Bell, Hand, History, type LucideIcon, Navigation, UserRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { elevation, radius, space, spring, touchTarget, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Text } from '@/ui/text';

import {
  closeMenu,
  menuHover,
  PERSON_ACTIONS,
  type PersonAction,
  radialPosition,
  usePersonFocus,
} from './person-focus';

const ICONS: Record<PersonAction, LucideIcon> = {
  poke: Hand,
  directions: Navigation,
  history: History,
  profile: UserRound,
  notifications: Bell,
};
/** A hovered item grows this much (under the finger). */
const HOVER_SCALE = 1.18;

function Item({
  action,
  index,
  onPick,
}: {
  action: PersonAction;
  index: number;
  onPick: (action: PersonAction) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const hovered = useAnimatedStyle(() => {
    const on = menuHover.get() === index;
    return {
      transform: [{ scale: withSpring(on ? HOVER_SCALE : 1, spring.snappy) }],
      backgroundColor: on ? colors.primary : colors.surfaceRaised,
    };
  });
  const Icon = ICONS[action];
  return (
    <Animated.View entering={motion.radialAt(index)} style={styles.item}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(`map.actions.${action}`)}
        onPress={() => {
          onPick(action);
        }}
      >
        <Animated.View style={[styles.button, { boxShadow: elevation.floating }, hovered]}>
          <Icon color={colors.text} size={22} strokeWidth={2.25} />
        </Animated.View>
      </Pressable>
      <View style={[styles.label, { backgroundColor: colors.surfaceRaised }]}>
        <Text variant="caption" allowFontScaling={false}>
          {t(`map.actions.${action}`)}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * The menu around a held avatar (BARGU_PLAN §4.3): poke, directions, profile, notifications. Hold
 * and slide onto an item, or let go and tap one; tapping anywhere else closes it.
 */
export function RadialMenu({ onPick }: { onPick: (userId: string, action: PersonAction) => void }) {
  const { t } = useTranslation();
  const menu = usePersonFocus((state) => state.menu);
  if (menu === null) return null;
  const pick = (action: PersonAction) => {
    closeMenu();
    onPick(menu.userId, action);
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={t('map.actions.close')}
        onPress={closeMenu}
      />
      {PERSON_ACTIONS.map((action, index) => {
        const at = radialPosition(menu.origin, menu.below, index);
        return (
          <View
            key={action}
            pointerEvents="box-none"
            style={[styles.slot, { left: at.x - SLOT / 2, top: at.y - touchTarget / 2 }]}
          >
            <Item action={action} index={index} onPick={pick} />
          </View>
        );
      })}
    </View>
  );
}

const SLOT = touchTarget * 2;

const styles = StyleSheet.create({
  slot: { position: 'absolute', width: SLOT, alignItems: 'center' },
  item: { alignItems: 'center', gap: space.xxs },
  button: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { paddingHorizontal: space.sm, borderRadius: radius.pill },
});

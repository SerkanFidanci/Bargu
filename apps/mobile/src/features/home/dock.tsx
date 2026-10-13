import type { Me } from '@bargu/schemas';
import { Plus, Users } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { choreography, elevation, radius, space, spring, touchTarget, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

export interface DockProps {
  me: Me;
  onCircles: () => void;
  onAdd: () => void;
  onMe: () => void;
  /** The add sheet is open: the + turns into a close cross. */
  addOpen: boolean;
}

/** The three-item bar at the bottom of the map: Circles · Add · Me (BARGU_PLAN §4.3). */
export function Dock({ me, onCircles, onAdd, onMe, addOpen }: DockProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withSpring(addOpen ? choreography.addTurn : 0, spring.bouncy));
  }, [addOpen, turn]);
  const turned = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(turn.get())}deg` }] }));
  return (
    <View
      style={[
        styles.dock,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
      ]}
    >
      <DockItem label={t('main.dock.circles')} onPress={onCircles} testID="dock-circles">
        <Users color={colors.text} size={24} strokeWidth={2.25} />
      </DockItem>
      <Animated.View style={turned}>
        <IconButton
          testID="dock-add"
          icon={Plus}
          label={addOpen ? t('ui.sheet.close') : t('main.dock.add')}
          tone="primary"
          size={touchTarget + space.md}
          onPress={onAdd}
        />
      </Animated.View>
      <DockItem label={t('main.dock.me')} onPress={onMe} testID="dock-me">
        <Avatar avatar={me.avatar} name={me.displayName ?? '?'} size="sm" />
      </DockItem>
    </View>
  );
}

function DockItem({
  label,
  onPress,
  children,
  testID,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  return (
    <PressableScale
      testID={testID}
      haptic="select"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.item}
    >
      {children}
      <Text variant="caption" color="textMuted" maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    marginHorizontal: space.lg,
  },
  item: {
    minWidth: touchTarget + space.xl,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
});

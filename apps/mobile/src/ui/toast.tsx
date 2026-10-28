import { CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react-native';
import { type ReactNode, useEffect } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { type ColorName, elevation, radius, space, timing, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { useMotion } from '@/theme/use-motion';

import { Text } from './text';

export type ToastTone = 'info' | 'success' | 'error';

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
  /** A notice can be tapped to go where it happened (e.g. the circle). */
  onPress?: (() => void) | undefined;
}

interface ToastState {
  current: ToastMessage | null;
  /** How tall the toast shown is, once drawn (0 with none): what ClearOfToast makes room for. */
  room: number;
  show: (message: string, tone?: ToastTone, onPress?: () => void) => void;
  dismiss: (id: number) => void;
  measured: (id: number, height: number) => void;
}

/** How long a toast stays when nobody taps it. */
const TOAST_VISIBLE_MS = 3500;
/** A notice about other people (an invitation, someone joined) stays a little longer. */
const NOTICE_VISIBLE_MS = 5500;

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  current: null,
  room: 0,
  show: (message, tone = 'info', onPress) => {
    set({ current: { id: nextId++, message, tone, onPress } });
  },
  dismiss: (id) => {
    set((state) => (state.current?.id === id ? { current: null, room: 0 } : state));
  },
  measured: (id, height) => {
    set((state) => (state.current?.id === id ? { room: height } : state));
  },
}));

/** Show a short, non-blocking message (e.g. a failed optimistic update rolled back). */
export const toast = {
  info: (message: string) => {
    useToasts.getState().show(message, 'info');
  },
  success: (message: string) => {
    useToasts.getState().show(message, 'success');
  },
  error: (message: string) => {
    useToasts.getState().show(message, 'error');
  },
  /** Something other people did; tapping it opens where it happened. */
  notice: (message: string, tone: ToastTone, onPress: () => void) => {
    useToasts.getState().show(message, tone, onPress);
  },
};

const TONES: Record<ToastTone, { icon: LucideIcon; color: ColorName }> = {
  info: { icon: Info, color: 'primary' },
  success: { icon: CircleCheck, color: 'success' },
  error: { icon: CircleAlert, color: 'danger' },
};

/** Renders the current toast at the top of the screen; mount once in the root layout. */
export function ToastHost() {
  const current = useToasts((state) => state.current);
  const dismiss = useToasts((state) => state.dismiss);
  const measured = useToasts((state) => state.measured);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const motion = useMotion();

  useEffect(() => {
    if (current === null) return;
    AccessibilityInfo.announceForAccessibility(current.message);
    if (current.tone === 'success') feedback('success');
    const timer = setTimeout(
      () => {
        dismiss(current.id);
      },
      current.onPress === undefined ? TOAST_VISIBLE_MS : NOTICE_VISIBLE_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [current, dismiss]);

  if (current === null) return null;
  const tone = TONES[current.tone];
  const Icon = tone.icon;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + space.sm }]}>
      <Animated.View
        key={current.id}
        testID="toast"
        entering={motion.enterDown}
        exiting={motion.exitUp}
        onLayout={(event) => {
          measured(current.id, event.nativeEvent.layout.height);
        }}
      >
        <Pressable
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          onPress={() => {
            dismiss(current.id);
            current.onPress?.();
          }}
          style={[
            styles.toast,
            { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
          ]}
        >
          <Icon color={colors[tone.color]} size={20} strokeWidth={2.25} />
          <Text variant="subhead" style={styles.message}>
            {current.message}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * What sits at the top of a screen, under where the toast comes (on the map: "who sees me", the
 * weather and the cards under them): moved down out of its way while one shows, back after, so the
 * two are never drawn over each other (the owner, 2026-10-28). Only this redraws for a toast, not
 * the screen around it.
 */
export function ClearOfToast({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const room = useToasts((state) => state.room);
  const shift = useSharedValue(0);
  useEffect(() => {
    shift.set(withTiming(room === 0 ? 0 : room + space.sm, timing.base));
  }, [room, shift]);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: shift.get() }] }));
  return (
    <Animated.View testID="clear-of-toast" style={[style, moved]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    maxWidth: 480,
  },
  message: { flexShrink: 1 },
});

import { CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { type ColorTokens, elevation, radius, space, useTheme } from '@/theme';
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
  show: (message: string, tone?: ToastTone, onPress?: () => void) => void;
  dismiss: (id: number) => void;
}

/** How long a toast stays when nobody taps it. */
export const TOAST_VISIBLE_MS = 3500;
/** A notice about other people (an invitation, someone joined) stays a little longer. */
export const NOTICE_VISIBLE_MS = 5500;

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  current: null,
  show: (message, tone = 'info', onPress) => {
    set({ current: { id: nextId++, message, tone, onPress } });
  },
  dismiss: (id) => {
    set((state) => (state.current?.id === id ? { current: null } : state));
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

const TONES: Record<ToastTone, { icon: LucideIcon; color: keyof ColorTokens }> = {
  info: { icon: Info, color: 'primary' },
  success: { icon: CircleCheck, color: 'success' },
  error: { icon: CircleAlert, color: 'danger' },
};

/** Renders the current toast at the top of the screen; mount once in the root layout. */
export function ToastHost() {
  const current = useToasts((state) => state.current);
  const dismiss = useToasts((state) => state.dismiss);
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
      <Animated.View key={current.id} entering={motion.enterDown} exiting={motion.exitUp}>
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

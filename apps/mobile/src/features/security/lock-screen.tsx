import { Lock } from 'lucide-react-native';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { shouldLock, unlockApp, useAppLock } from './app-lock';

/**
 * Locks the app again after a minute in the background (docs/ADR/0021). Only "background" counts:
 * the system's own Face ID sheet makes the app briefly inactive, which is not leaving it.
 */
export function useAppLockWatcher(): void {
  useEffect(() => {
    let awaySince: number | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        awaySince = Date.now();
      } else if (state === 'active' && awaySince !== null) {
        const away = Date.now() - awaySince;
        awaySince = null;
        if (shouldLock(useAppLock.getState().enabled, away)) useAppLock.setState({ locked: true });
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);
}

/**
 * What a locked app shows, over everything: nothing of the map, the circles or the people. It asks
 * the phone at once, and again with the button.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const asking = useRef(false);

  const unlock = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    try {
      await unlockApp({ prompt: t('security.lock.prompt'), cancel: t('common.cancel') });
    } finally {
      asking.current = false;
    }
  }, [t]);

  useEffect(() => {
    if (AppState.currentState === 'active') void unlock();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void unlock();
    });
    return () => {
      subscription.remove();
    };
  }, [unlock]);

  return (
    <Animated.View
      entering={motion.fadeIn}
      testID="lock-screen"
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <Lock color={colors.primary} size={32} strokeWidth={2.25} />
      </View>
      <Text variant="title2" align="center">
        {t('security.lock.title')}
      </Text>
      <Text variant="callout" color="textMuted" align="center">
        {t('security.lock.body')}
      </Text>
      <Button
        testID="lock-unlock"
        label={t('security.lock.unlock')}
        icon={Lock}
        onPress={() => {
          void unlock();
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  badge: {
    width: space.xxxl + space.lg,
    height: space.xxxl + space.lg,
    borderRadius: space.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Whether this screen is what the user sees: focused (no other page over it) and the app in the
 * foreground. The map pauses its motion otherwise (docs/ADR/0027: nothing runs unseen).
 */
export function useOnScreen(): boolean {
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
      };
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);
  return focused && active;
}

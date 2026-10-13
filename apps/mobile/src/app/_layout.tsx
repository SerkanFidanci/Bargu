// Must stay first: installs the CSPRNG before any module can generate keys.
import '@/platform/secure-random';
// Then the native curve operations, which self-test with that CSPRNG.
import '@/platform/native-crypto';
import '@/i18n';

import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DEV_TOOLS_ENABLED } from '@/config/env';
import { bootstrapAuth, useAuth } from '@/features/auth/auth-store';
import { loadMapAppearance } from '@/features/map/appearance';
import { isProfileComplete, useMe } from '@/features/profile/queries';
import { queryClient } from '@/features/query-client';
import { useTheme } from '@/theme';
import { navigationTheme } from '@/theme/navigation';
import { ToastHost } from '@/ui/toast';

void SplashScreen.preventAutoHideAsync();
void bootstrapAuth();
void loadMapAppearance();

export default function RootLayout() {
  const theme = useTheme();
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navigationTheme(theme)}>
            <BottomSheetModalProvider>
              <Routes />
              <ToastHost />
            </BottomSheetModalProvider>
            <StatusBar style="auto" />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Which part of the app is reachable: sign-in when signed out, onboarding until the profile has a
 * username and a name, then the map. Protected routes redirect on their own when this changes.
 */
function Routes() {
  const status = useAuth((state) => state.status);
  const me = useMe();
  const signedIn = status === 'signedIn';
  const profileKnown = signedIn && me.data !== undefined;
  const complete = profileKnown && isProfileComplete(me.data);
  // Keep the splash until we know where to go (the profile loads once after sign-in).
  // A failed first load (offline) shows the connecting screen while the query keeps retrying.
  const connecting = status === 'loading' || (signedIn && !profileKnown);
  const ready = status === 'signedOut' || profileKnown || me.failureCount > 0;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Protected guard={connecting}>
        <Stack.Screen name="connecting" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={profileKnown && !complete}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={complete}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={DEV_TOOLS_ENABLED}>
        <Stack.Screen name="_dev/crypto" options={{ headerShown: true }} />
        <Stack.Screen name="_dev/ui" options={{ headerShown: true }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

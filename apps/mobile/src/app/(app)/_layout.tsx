import { Stack } from 'expo-router';

import { useLiveSession } from '@/features/live/live-session';
import { useLocationSession } from '@/features/location/use-location';
import { usePushNotifications } from '@/features/notifications/use-push';
import { usePrivacyGate } from '@/features/account/privacy-gate';
import { useAppLock } from '@/features/security/app-lock';
// Guardian links follow their events (docs/ADR/0023 §4).
import '@/features/guardians/guardians-session';
import { LockScreen, useAppLockWatcher } from '@/features/security/lock-screen';

export const unstable_settings = { initialRouteName: 'index' };

export default function AppLayout() {
  // Keys and the event position live in the encrypted vault: open it before anything reads them.
  const ready = useLiveSession();
  // Right after sign-in: ask for notifications once and register this phone.
  usePushNotifications(ready);
  // Then the location: permission, the location service, live mode (Faz 5).
  useLocationSession(ready);
  // The optional app lock (docs/ADR/0021): after a minute away, and over everything when locked.
  useAppLockWatcher();
  // KVKK (docs/ADR/0022): the information notice, and consent to history where it is on.
  usePrivacyGate(ready);
  const locked = useAppLock((state) => state.locked);
  if (!ready) return null;
  // Locked: the lock alone. Nothing under it to read aloud (TalkBack) and no screen presented
  // above it (an iOS modal); unlocked, the app starts again from the map (QA 3a-B2).
  if (locked) return <LockScreen />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/[id]/index" />
      <Stack.Screen name="circle/[id]/invite" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/[id]/verify/[userId]" />
      <Stack.Screen name="add/username" options={{ presentation: 'modal' }} />
      <Stack.Screen name="add/qr" />
      <Stack.Screen name="add/scan" />
      <Stack.Screen name="i/[token]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="g/[token]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="place/[circleId]" />
      <Stack.Screen name="history/viewers" />
      <Stack.Screen name="history/[userId]" />
      <Stack.Screen name="security" />
      <Stack.Screen name="seers" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="consent" options={{ presentation: 'modal' }} />
      <Stack.Screen name="notice" options={{ presentation: 'modal', gestureEnabled: false }} />
    </Stack>
  );
}

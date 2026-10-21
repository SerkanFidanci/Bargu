import { Stack } from 'expo-router';

import { useLiveSession } from '@/features/live/live-session';
import { useLocationSession } from '@/features/location/use-location';
import { usePushNotifications } from '@/features/notifications/use-push';
import { usePrivacyGate } from '@/features/account/privacy-gate';
import { useLookSession } from '@/features/cosmetics/look-wiring';
import { useAppLock } from '@/features/security/app-lock';
import { useSafeSpotNavigation } from '@/features/social/use-safe-spot';
// Guardian links follow their events (docs/ADR/0023 §4).
import '@/features/guardians/guardians-session';
// The plan follows its events; the trial reminder follows the plan (docs/ADR/0024).
import '@/features/billing/billing-session';
import { LockScreen, useAppLockWatcher } from '@/features/security/lock-screen';
import { useTimeUp } from '@/features/guardians/screen-time-session';
import { TimeUpScreen } from '@/features/guardians/time-up-screen';

export const unstable_settings = { initialRouteName: 'index' };

export default function AppLayout() {
  // Keys and the event position live in the encrypted vault: open it before anything reads them.
  const ready = useLiveSession();
  // Right after sign-in: ask for notifications once and register this phone.
  usePushNotifications(ready);
  // A tapped "Güvendeyim" shows the place on the map: what stands over the map makes way.
  useSafeSpotNavigation();
  // Then the location: permission, the location service, live mode (Faz 5).
  useLocationSession(ready);
  // The looks on the map pin: the own pass renewed, the look told to circles (docs/ADR/0025).
  useLookSession(ready);
  // The optional app lock (docs/ADR/0021): after a minute away, and over everything when locked.
  useAppLockWatcher();
  // KVKK (docs/ADR/0022): the information notice, and consent to history where it is on.
  usePrivacyGate(ready);
  // A parent's daily limit (docs/ADR/0023 §5): the app closes for the day, the location goes on.
  const timeUp = useTimeUp(ready);
  const locked = useAppLock((state) => state.locked);
  if (!ready) return null;
  // Locked: the lock alone. Nothing under it to read aloud (TalkBack) and no screen presented
  // above it (an iOS modal); unlocked, the app starts again from the map (QA 3a-B2).
  if (locked) return <LockScreen />;
  if (timeUp) return <TimeUpScreen />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/[id]/index" />
      <Stack.Screen name="circle/[id]/invite" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/[id]/sharing" />
      <Stack.Screen name="circle/[id]/places" />
      <Stack.Screen name="circle/[id]/verify/[userId]" />
      <Stack.Screen name="add/username" options={{ presentation: 'modal' }} />
      <Stack.Screen name="add/qr" />
      <Stack.Screen name="add/scan" />
      <Stack.Screen name="i/[token]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="g/[token]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="place/[circleId]" />
      <Stack.Screen name="meeting/new" />
      <Stack.Screen name="meeting/[circleId]" />
      <Stack.Screen name="history/viewers" />
      <Stack.Screen name="history/[userId]" />
      <Stack.Screen name="security" />
      <Stack.Screen name="seers" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="settings/location" />
      <Stack.Screen name="settings/look" />
      <Stack.Screen name="settings/about" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="plus" />
      <Stack.Screen name="consent" options={{ presentation: 'modal' }} />
      <Stack.Screen name="notice" options={{ presentation: 'modal', gestureEnabled: false }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';

import { useLiveSession } from '@/features/live/live-session';
import { useLocationSession } from '@/features/location/use-location';
import { usePushNotifications } from '@/features/notifications/use-push';

export const unstable_settings = { initialRouteName: 'index' };

export default function AppLayout() {
  // Keys and the event position live in the encrypted vault: open it before anything reads them.
  const ready = useLiveSession();
  // Right after sign-in: ask for notifications once and register this phone.
  usePushNotifications(ready);
  // Then the location: permission, the location service, live mode (Faz 5).
  useLocationSession(ready);
  if (!ready) return null;
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
      <Stack.Screen name="place/[circleId]" />
      <Stack.Screen name="history/viewers" />
      <Stack.Screen name="history/[userId]" />
    </Stack>
  );
}

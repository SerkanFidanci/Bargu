import { Stack } from 'expo-router';

import { useLiveSession } from '@/features/live/live-session';

export const unstable_settings = { initialRouteName: 'index' };

export default function AppLayout() {
  // Keys and the event position live in the encrypted vault: open it before anything reads them.
  const ready = useLiveSession();
  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="circle/[id]/index" />
      <Stack.Screen name="circle/[id]/verify/[userId]" />
      <Stack.Screen name="add/username" options={{ presentation: 'modal' }} />
      <Stack.Screen name="add/qr" />
      <Stack.Screen name="add/scan" />
      <Stack.Screen name="i/[token]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

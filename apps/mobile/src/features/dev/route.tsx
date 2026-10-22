import { Redirect, Stack } from 'expo-router';

import { type DevScreenName, useDevSlots } from './slots';

/**
 * The body of a route in app/_dev: the developer screen that features/dev/tools.ts put in its slot,
 * or the map where the build has none (a production bundle never has one).
 */
export function DevRoute({ name }: { name: DevScreenName }) {
  const screen = useDevSlots((state) => state.screens[name]);
  if (screen === undefined) return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ headerShown: true }} />
      {screen}
    </>
  );
}

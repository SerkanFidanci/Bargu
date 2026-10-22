// The app's entry (package.json "main"). Order matters:
// 1. the CSPRNG, before any module can generate keys;
import './src/platform/secure-random';
// 2. the native curve operations, which self-test with that CSPRNG;
import './src/platform/native-crypto';
// 3. the background location task, defined before anything renders: Android may start the app
//    without a screen just to deliver a location (src/features/location/background-task.ts);
import './src/features/location/background-task';
// 4. the notification task, for the same reason: a sealed notification may wake the app alone
//    (src/features/notifications/background-push.ts);
import './src/features/notifications/background-push';
// 5. the screens.
import 'expo-router/entry';
// The slot background live mode fills when a build has it (below).
import { backgroundLive } from './src/features/location/background-live/slot';

// The developer tools, in development and preview builds only: the measurement overlay with its
// stall meter (docs/ADR/0028), then the developer rows, the fake people on the map and the
// developer screens with all their texts. The condition is a constant when a release bundle is
// built (Expo inlines EXPO_PUBLIC_* there), so a production bundle does not contain any of it, not
// even switched off. Nothing else may import features/dev (apps/mobile/scripts/check-bundle.mjs
// builds a bundle and looks for what leaked); the screens read the empty places in
// features/dev/slots.ts.
if (__DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1') {
  void import('./src/features/dev/measure');
  void import('./src/features/dev/tools');
}

// Background live mode (docs/ADR/0028 step 3): the same way, in preview builds only until the
// owner's phone trial and the PM's approval. A production bundle has no code of it; there a
// `watch` notice is dropped (src/features/notifications/background-push.ts).
if (process.env.EXPO_PUBLIC_BG_LIVE === '1') {
  backgroundLive.loading = import('./src/features/location/background-live');
}

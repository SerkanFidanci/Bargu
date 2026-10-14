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

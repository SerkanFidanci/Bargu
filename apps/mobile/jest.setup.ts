// Test doubles for native modules that have no JavaScript implementation under Jest.
import 'react-native-gesture-handler/jestSetup';

import { setUpTests } from 'react-native-reanimated';

setUpTests();

jest.mock('@gorhom/bottom-sheet', () =>
  jest.requireActual<Record<string, unknown>>('@gorhom/bottom-sheet/mock'),
);

jest.mock(
  'react-native-safe-area-context',
  () =>
    jest.requireActual<{ default: unknown }>('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Heavy: 'heavy' },
}));

jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Map: View, Camera: () => null };
});

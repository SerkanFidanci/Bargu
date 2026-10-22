import { render } from '@testing-library/react-native';

import '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
}));
// The map's appearance choice is kept in the secure store, whose native module is not there on
// Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
// The native map: a stand-in that keeps the props it was given.
const mockMapProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Map: (props: Record<string, unknown>) => {
      mockMapProps.current = props;
      return <View />;
    },
    Camera: () => null,
  };
});

import { BarguMap } from './bargu-map';

describe('the map on a screen that slides in (the owner saw it tear, 2026-10-22)', () => {
  it('is drawn in a TextureView on Android, which moves with the transition', async () => {
    await render(<BarguMap insets={{}} overlay />);
    expect(mockMapProps.current?.androidView).toBe('texture');
  });

  it('leaves the home map on the default, faster SurfaceView', async () => {
    await render(<BarguMap insets={{}} />);
    expect(mockMapProps.current).not.toHaveProperty('androidView');
  });
});

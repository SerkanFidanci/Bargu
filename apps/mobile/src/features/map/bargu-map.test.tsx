import { render } from '@testing-library/react-native';

import '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
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

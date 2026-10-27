import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// map-shortcuts imports the location session and the router; neither is what is tested here.
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// The store's button has its own tests (store-button.test.tsx).
jest.mock('@/features/home/store-button', () => ({ StoreButton: () => null }));
jest.mock('@/features/location/location-session', () => ({
  sayArrived: jest.fn(),
  updateSharing: jest.fn(),
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

import { MapShortcuts } from './map-shortcuts';
import { SafeButton } from './safe-button';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('"Güvendeyim" on the map (docs/ADR/0029)', () => {
  it('is one tap away and says what it does', async () => {
    const onPress = jest.fn();
    await render(<SafeButton bottom={120} onPress={onPress} />);
    const button = screen.getByTestId('shortcut-safe');
    expect(button.props.accessibilityLabel).toBe(i18n.t('map.shortcuts.safe'));
    expect(button.props.accessibilityRole).toBe('button');
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not one of the three round shortcuts of the right edge', async () => {
    await render(
      <MapShortcuts
        circles={[]}
        away
        onRecenter={jest.fn()}
        meeting={null}
        me={null}
        now={0}
        bottom={0}
        shared={false}
      />,
    );
    // Back to me, ghost mode, a meeting: three at most, as the owner asked (docs/ADR/0026 §8).
    const column = screen.getByTestId('map-shortcuts');
    expect(screen.getByTestId('shortcut-recenter')).toBeTruthy();
    expect(screen.getByTestId('shortcut-ghost')).toBeTruthy();
    expect(screen.getByTestId('shortcut-meet')).toBeTruthy();
    expect(screen.queryByTestId('shortcut-safe')).toBeNull();
    expect(column).toBeTruthy();
  });
});

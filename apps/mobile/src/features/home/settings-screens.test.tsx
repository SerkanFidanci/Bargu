import { fireEvent, render, screen } from '@testing-library/react-native';

import AboutScreen from '@/app/(app)/settings/about';
import LocationSettingsScreen from '@/app/(app)/settings/location';
import LookSettingsScreen from '@/app/(app)/settings/look';
import i18n from '@/i18n';

// Native modules jest does not have on Linux (CI), though Windows resolves them.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '1.2.3' },
  DEV_TOOLS_ENABLED: false,
}));
const mockPush = jest.fn<undefined, [unknown]>();
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: (route: unknown) => {
      mockPush(route);
    },
  },
}));
jest.mock('@/features/storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('@/features/location/location-session', () => ({ updateSharing: jest.fn() }));
jest.mock('@/features/circles/queries', () => ({ useCircles: () => ({ data: [] }) }));
jest.mock('@/features/profile/queries', () => ({ useMe: () => ({ data: undefined }) }));
jest.mock('@/features/auth/auth-store', () => ({
  onSignedIn: jest.fn(),
  onSignedOut: jest.fn(),
  useAuth: (select: (state: { userId: string }) => unknown) =>
    select({ userId: '0190f7a4-1111-7111-8111-000000000001' }),
}));
// Watches the battery (expo-battery, native): not what is tested here.
jest.mock('@/features/home/effect-prefs', () => ({ setEffectLevel: jest.fn() }));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockPush.mockClear();
});

describe('the screens behind the Me rows (the owner, 2026-10-21)', () => {
  it('"Konum ve gizlilik": the ghost, who sees the location, the history', async () => {
    await render(<LocationSettingsScreen />);
    expect(screen.getByTestId('ghost-mode')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('location-seers'));
    expect(mockPush).toHaveBeenLastCalledWith('/seers');
    await fireEvent.press(screen.getByTestId('location-history'));
    expect(mockPush).toHaveBeenLastCalledWith('/history/viewers');
  });

  it('"Görünüm ve harita": the map look and the effects', async () => {
    await render(<LookSettingsScreen />);
    expect(screen.getByTestId('map-appearance')).toBeTruthy();
    expect(screen.getByTestId('effects-level')).toBeTruthy();
  });

  it('"Uygulama": this phone, the map data and the version', async () => {
    await render(<AboutScreen />);
    expect(screen.getByText('Harita verisi')).toBeTruthy();
    expect(screen.getByText('Sürüm 1.2.3')).toBeTruthy();
  });
});

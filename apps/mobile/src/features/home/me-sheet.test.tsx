import type { Me } from '@bargu/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { AddSheet } from '../circles/add-sheet';
import { takeReturn, useSheetReturn } from './sheet-return';
import { MeSheet } from './sheets';

// Native modules jest does not have on Linux (CI), though Windows resolves them: the secure store,
// the notifications and the device lock.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(() => Promise.resolve({ type: 'fcm', data: '' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(0)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: false })),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
const mockPush = jest.fn<undefined, [unknown]>();
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => {
      mockPush(route);
    },
  },
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('@/features/auth/auth-store', () => ({
  signOut: jest.fn(),
  onSignedOut: jest.fn(),
  onSignedIn: jest.fn(),
  useAuth: (select: (state: { userId: string }) => unknown) =>
    select({ userId: '0190f7a4-1111-7111-8111-000000000001' }),
}));
jest.mock('@/features/auth/passkeys', () => ({
  addPasskey: jest.fn(),
  passkeyDiagnostic: () => '',
  passkeyFailure: () => 'cancelled',
  passkeysSupported: () => true,
}));
jest.mock('@/features/storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('@/features/billing/plan', () => ({ usePlan: () => ({ data: undefined }) }));
jest.mock('@/features/circles/queries', () => ({ useCircles: () => ({ data: [] }) }));
jest.mock('@/features/location/location-session', () => ({ updateSharing: jest.fn() }));
// Watches the battery (expo-battery, native): not what is tested here.
jest.mock('@/features/home/effect-prefs', () => ({ setEffectLevel: jest.fn() }));

const me: Me = {
  userId: '0190f7a4-1111-7111-8111-000000000001',
  username: 'seko',
  displayName: 'Seko',
  avatar: null,
  device: { id: '0190f7a4-1111-7111-8111-000000000002', platform: 'android', attested: true },
  passkeys: 0,
};

function withQueries(node: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockPush.mockClear();
});

describe('the Me sheet, one row per part (the owner, 2026-10-21)', () => {
  it('lists the parts as rows, "Konum ve gizlilik" first right under the profile', async () => {
    await render(withQueries(<MeSheet me={me} onClose={jest.fn()} onStatus={jest.fn()} />));
    const labels = screen
      .getAllByRole('button')
      .map((node) => String((node.props as { accessibilityLabel?: string }).accessibilityLabel))
      .map((label) => label.split(',')[0] ?? '');
    const parts = [
      'Konum ve gizlilik',
      'Bildirimler',
      'Görünüm ve harita',
      'Güvenlik',
      'Bargu+',
      'Hesap ve veri',
      'Uygulama',
    ];
    const at = parts.map((part) => labels.indexOf(part));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // No controls left open on the sheet itself: they are on their screens.
    expect(screen.queryByTestId('ghost-mode')).toBeNull();
    expect(screen.queryByTestId('effects-level')).toBeNull();
  });

  it('opens each part on its own screen and comes back to the sheet afterwards', async () => {
    const onClose = jest.fn();
    await render(withQueries(<MeSheet me={me} onClose={onClose} onStatus={jest.fn()} />));
    for (const [row, path] of [
      ['me-location', '/settings/location'],
      ['me-notifications', '/notifications'],
      ['me-look', '/settings/look'],
      ['me-security', '/security'],
      ['me-account', '/privacy'],
      ['me-app', '/settings/about'],
    ] as const) {
      useSheetReturn.setState({ pending: null });
      await fireEvent.press(screen.getByTestId(row));
      expect(mockPush).toHaveBeenLastCalledWith(path);
      expect(takeReturn()).toBe('me');
    }
    expect(onClose).toHaveBeenCalledTimes(6);
  });
});

describe('the "+" sheet (UX düzeni 5)', () => {
  it('is called "Ekle" and creates a circle too', async () => {
    await render(withQueries(<AddSheet onDismiss={jest.fn()} onClose={jest.fn()} />));
    expect(screen.getByText('Ekle')).toBeTruthy();
    await fireEvent.press(screen.getByText('Çember oluştur'));
    expect(mockPush).toHaveBeenLastCalledWith('/circle/new');
  });
});

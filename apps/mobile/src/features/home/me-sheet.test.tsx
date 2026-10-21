import type { Me } from '@bargu/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { AddSheet } from '../circles/add-sheet';
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

describe('the Me sheet, grouped (UX düzeni 2, 3, 10)', () => {
  it('puts "Konum ve gizlilik" right under the profile, then the other titled groups', async () => {
    await render(withQueries(<MeSheet me={me} onClose={jest.fn()} onStatus={jest.fn()} />));
    const titles = screen.getAllByRole('header').map((node) => {
      const text: unknown = node.props.children;
      return typeof text === 'string' ? text : '';
    });
    // The sheet's own title first, then its groups.
    expect(titles.filter((title) => title !== '')).toEqual([
      'Ben',
      'Konum ve gizlilik',
      'Bildirimler',
      'Görünüm ve harita',
      'Güvenlik',
      'Bargu+ ve hesap',
      'Uygulama',
    ]);
  });

  it('leads to who sees the location, the notification preferences and "Hesap ve veri"', async () => {
    await render(withQueries(<MeSheet me={me} onClose={jest.fn()} onStatus={jest.fn()} />));
    await fireEvent.press(screen.getByTestId('me-seers'));
    expect(mockPush).toHaveBeenLastCalledWith('/seers');
    await fireEvent.press(screen.getByTestId('me-notifications'));
    expect(mockPush).toHaveBeenLastCalledWith('/notifications');
    expect(screen.getByText('Hesap ve veri')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('me-account'));
    expect(mockPush).toHaveBeenLastCalledWith('/privacy');
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

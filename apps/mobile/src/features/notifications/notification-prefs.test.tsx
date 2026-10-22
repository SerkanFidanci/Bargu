import type { Circle } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { NO_MUTES, useMutes, withPersonMuted } from '@/features/notifications/mutes';
import { usePushState } from '@/features/notifications/push';
import i18n from '@/i18n';

import NotificationsScreen from '@/app/(app)/notifications';

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
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('@/features/notifications/extension-share', () => ({
  shareMutesWithExtension: () => Promise.resolve(),
}));
jest.mock('@/features/notifications/use-push', () => ({ askForPush: jest.fn() }));
const BEN = '0190a8a0-0000-7000-8000-0000000000e1';
const mockCircles: Circle[] = [
  {
    id: '0190a8a0-0000-7000-8000-0000000000e9',
    kind: 'pair',
    name: null,
    epoch: 1,
    epochStartedAt: 0,
    myRole: 'owner',
    myStatus: 'active',
    members: [
      {
        userId: BEN,
        role: 'owner',
        status: 'active',
        username: 'ben',
        displayName: 'Ben',
        avatar: null,
        device: null,
      },
    ],
  },
];
jest.mock('@/features/circles/queries', () => ({ useCircles: () => ({ data: mockCircles }) }));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  useMutes.setState(NO_MUTES, true);
  usePushState.setState({ state: 'enabled' });
});

describe('notification preferences (UX düzeni 9)', () => {
  it('lists who is muted here and gives their sound back with one tap', async () => {
    useMutes.setState(withPersonMuted(NO_MUTES, BEN, { places: true, pokes: true }), true);
    await render(<NotificationsScreen />);
    expect(screen.getByText('Bildirimler açık')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByText('Varışlar ve ayrılışlar · Dürtmeler')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`unmute-${BEN}`));
    expect(useMutes.getState().people[BEN]).toBeUndefined();
    expect(screen.queryByTestId(`muted-${BEN}`)).toBeNull();
    expect(screen.getByText('Kimseyi sessize almadın')).toBeTruthy();
  });

  it('offers the phone settings once notifications were refused', async () => {
    usePushState.setState({ state: 'denied' });
    await render(<NotificationsScreen />);
    expect(screen.getByText('Bildirimler kapalı')).toBeTruthy();
    expect(screen.getByTestId('push-settings')).toBeTruthy();
  });
});

// A mute is the user's own protection, so it outlives the shared circle (forget-person.ts): what is
// left of such a person is a user id and the flags, listed without a name or a photo.
describe('a muted person no circle is shared with any more', () => {
  const GONE = '0190a8a0-0000-7000-8000-0000000000e2';
  const muted = () =>
    withPersonMuted(withPersonMuted(NO_MUTES, BEN, { pokes: true }), GONE, {
      places: true,
      pokes: true,
    });

  it('is listed as that, without a name, and keeps its flags', async () => {
    useMutes.setState(muted(), true);
    await render(<NotificationsScreen />);
    expect(screen.getByText('Ortak çemberiniz olmayan bir kişi')).toBeTruthy();
    expect(screen.getByTestId(`muted-${GONE}`)).toBeTruthy();
    expect(screen.getAllByText('Varışlar ve ayrılışlar · Dürtmeler')).toHaveLength(1);
    // Someone still shared with is named, and has no "remove from list".
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByTestId(`unmute-${BEN}`)).toBeTruthy();
    expect(screen.queryByTestId(`remove-${BEN}`)).toBeNull();
  });

  it('gets its sound back with "Sesi aç"', async () => {
    useMutes.setState(muted(), true);
    await render(<NotificationsScreen />);
    // One for Ben and one for the person nobody shares a circle with.
    expect(screen.getAllByText('Sesi aç')).toHaveLength(2);
    await fireEvent.press(screen.getByTestId(`unmute-${GONE}`));
    expect(useMutes.getState().people[GONE]).toBeUndefined();
    expect(screen.queryByTestId(`muted-${GONE}`)).toBeNull();
    // The other person's mute is not touched.
    expect(useMutes.getState().people[BEN]).toEqual({ places: false, pokes: true });
  });

  it('is deleted from the list with "Listeden kaldır", and only that entry', async () => {
    useMutes.setState(muted(), true);
    await render(<NotificationsScreen />);
    expect(screen.getByText('Listeden kaldır')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`remove-${GONE}`));
    expect(useMutes.getState().people[GONE]).toBeUndefined();
    expect(Object.keys(useMutes.getState().people)).toEqual([BEN]);
    expect(screen.queryByTestId(`muted-${GONE}`)).toBeNull();
    expect(screen.getByTestId(`muted-${BEN}`)).toBeTruthy();
  });

  it('reads the same in English', async () => {
    await i18n.changeLanguage('en');
    try {
      useMutes.setState(muted(), true);
      await render(<NotificationsScreen />);
      expect(screen.getByText('Someone you no longer share a circle with')).toBeTruthy();
      expect(screen.getAllByText('Unmute').length).toBeGreaterThan(0);
      expect(screen.getByText('Remove from list')).toBeTruthy();
    } finally {
      await i18n.changeLanguage('tr');
    }
  });
});

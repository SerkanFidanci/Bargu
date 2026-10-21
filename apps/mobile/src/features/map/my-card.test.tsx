import type { Me } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { DEFAULT_SHARING, useSharing } from '../location/sharing';
import { MyCard } from './my-card';

// Native modules jest does not have on Linux (CI), though Windows resolves them.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(0)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: false })),
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
jest.mock('expo-battery', () => ({
  BatteryState: { UNKNOWN: 0, UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
  useBatteryLevel: () => 0.42,
  useBatteryState: () => 1,
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
jest.mock('../storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('../location/location-session', () => ({ updateSharing: jest.fn() }));
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: [] }) }));
// The card needs only two numbers from the people layer, not the map markers behind them.
jest.mock('./people-layer', () => ({ LOW_BATTERY: 15, staleMinutes: () => undefined }));
const mockClose = jest.fn();
jest.mock('./person-focus', () => ({
  ...jest.requireActual<typeof import('./person-focus')>('./person-focus'),
  closeCard: () => {
    mockClose();
  },
}));

const me: Me = {
  userId: '0190f7a4-1111-7111-8111-000000000001',
  username: 'seko',
  displayName: 'Seko',
  avatar: null,
  device: { id: '0190f7a4-1111-7111-8111-000000000002', platform: 'android', attested: true },
  passkeys: 0,
};

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockPush.mockClear();
  mockClose.mockClear();
  useSharing.setState(DEFAULT_SHARING, true);
});

describe('the user’s own card (the owner, 2026-10-21)', () => {
  it('says who the location goes to, the battery, and has the ghost, without poke or meeting', async () => {
    const onStatus = jest.fn();
    await render(<MyCard me={me} from={{ x: 0, y: 0 }} onHeight={jest.fn()} onStatus={onStatus} />);
    expect(screen.getByText('Konumun şu an kimseye gitmiyor')).toBeTruthy();
    expect(screen.getByText('Pil %42')).toBeTruthy();
    expect(screen.getByTestId('ghost-mode')).toBeTruthy();
    expect(screen.queryByTestId('card-poke')).toBeNull();
    expect(screen.queryByTestId('card-meet')).toBeNull();
    await fireEvent.press(screen.getByTestId('my-status'));
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalled();
  });

  it('leads to who sees the location and to the location settings', async () => {
    await render(
      <MyCard me={me} from={{ x: 0, y: 0 }} onHeight={jest.fn()} onStatus={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('my-seers'));
    expect(mockPush).toHaveBeenLastCalledWith('/seers');
    await fireEvent.press(screen.getByTestId('my-settings'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings/location');
  });

  it('says so while a ghost', async () => {
    useSharing.setState({ ...DEFAULT_SHARING, ghost: 'hide' }, true);
    await render(
      <MyCard me={me} from={{ x: 0, y: 0 }} onHeight={jest.fn()} onStatus={jest.fn()} />,
    );
    expect(screen.getByText('Hayalet açık: konumun kimseye gitmiyor')).toBeTruthy();
  });
});

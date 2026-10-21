import type { Circle, Me, MemberCard } from '@bargu/schemas';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { DEFAULT_SHARING, useSharing } from '../location/sharing';
import { type LocationPermission, useLocationPermission } from '../location/tracker';
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
let mockCircles: Circle[] = [];
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: mockCircles }) }));
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
const member = (userId: string, name: string): MemberCard => ({
  userId,
  role: 'member',
  status: 'active',
  username: name.toLowerCase(),
  displayName: name,
  avatar: null,
  device: null,
});
/** A circle this user is in with a friend: with sharing on (the default), the friend sees them. */
const withFriend: Circle = {
  id: '0190f7a4-1111-7111-8111-0000000000c1',
  kind: 'pair',
  name: null,
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'owner',
  myStatus: 'active',
  members: [member(me.userId, 'Seko'), member('0190f7a4-1111-7111-8111-000000000003', 'Deniz')],
};
const setPermission = (state: LocationPermission) => {
  useLocationPermission.setState({ state });
};

beforeEach(() => {
  mockPush.mockClear();
  mockClose.mockClear();
  mockCircles = [];
  useSharing.setState(DEFAULT_SHARING, true);
  setPermission('granted');
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

// QA 27 B-1: the line on who sees the user said "Konumunu görenler: N" with no permission, or before
// it was known, while the pill on the map (sharingNow) said otherwise. The circle list is NOT empty
// here, so the path that used to count people is the one exercised.
describe('who the card says sees the location (QA 27 B-1)', () => {
  const renderCard = async () => {
    await render(
      <MyCard me={me} from={{ x: 0, y: 0 }} onHeight={jest.fn()} onStatus={jest.fn()} />,
    );
  };

  it('counts the people who see it while the location permission is granted', async () => {
    mockCircles = [withFriend];
    await renderCard();
    expect(screen.getByText('Konumunu görenler: 1')).toBeTruthy();
  });

  it.each(['blocked', 'undetermined'] as const)(
    'says there is no permission, not a count, when it is %s',
    async (state) => {
      mockCircles = [withFriend];
      setPermission(state);
      await renderCard();
      expect(screen.getByText('Konum izni yok: konumun gönderilmiyor')).toBeTruthy();
      expect(screen.queryByText(/Konumunu görenler/)).toBeNull();
    },
  );

  it('says it is checking, not a count, while the permission is not known yet', async () => {
    mockCircles = [withFriend];
    setPermission('unknown');
    await renderCard();
    expect(screen.getByText('Kontrol ediliyor…')).toBeTruthy();
    expect(screen.queryByText(/Konumunu görenler/)).toBeNull();
  });

  it('follows the permission as it changes, with no new circle or position', async () => {
    mockCircles = [withFriend];
    setPermission('unknown');
    await renderCard();
    expect(screen.getByText('Kontrol ediliyor…')).toBeTruthy();
    await act(() => {
      setPermission('granted');
    });
    expect(screen.getByText('Konumunu görenler: 1')).toBeTruthy();
    await act(() => {
      setPermission('blocked');
    });
    expect(screen.getByText('Konum izni yok: konumun gönderilmiyor')).toBeTruthy();
  });

  it('keeps saying nobody, whatever the permission, as the pill does', async () => {
    setPermission('blocked');
    await renderCard();
    expect(screen.getByText('Konumun şu an kimseye gitmiyor')).toBeTruthy();
  });

  it('keeps saying the ghost is on, whatever the permission, as the pill does', async () => {
    mockCircles = [withFriend];
    setPermission('blocked');
    useSharing.setState({ ...DEFAULT_SHARING, ghost: 'freeze' }, true);
    await renderCard();
    expect(screen.getByText('Hayalet açık: konumun kimseye gitmiyor')).toBeTruthy();
  });
});

import type { Circle, Me } from '@bargu/schemas';
import { configure, render, screen, within } from '@testing-library/react-native';

import i18n from '@/i18n';
import { EffectsPaused } from '@/theme/effects';

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
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/features/storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('@/features/location/location-session', () => ({
  updateSharing: jest.fn(),
  meetings: { eta: () => undefined },
}));
// A marker on the map is a plain view here: where it is drawn is not what is tested.
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Map: View, Camera: () => null, Marker: View };
});
// What the meeting watcher, the footprints and the burst (Skia) and the accuracy circles draw is
// not tested here.
jest.mock('@/features/map/use-meetings', () => ({ useMeetingWatcher: () => null }));
jest.mock('@/features/map/footprints', () => ({ Footprints: () => null }));
jest.mock('@/features/map/meet-burst', () => ({ MeetBurst: () => null }));
jest.mock('@/features/map/uncertainty-layer', () => ({ UncertaintyLayer: () => null }));

import { useMyFix } from '@/features/location/engine';
import { useLocations } from '@/features/location/receive';
import { nth } from '@/features/location/test-support';
import { useMapZoom } from '@/features/map/map-zoom';
import { PeopleLayer } from '@/features/map/people-layer';

import { useLooks, useMyLook } from './look-session';

// The pins' looks are hidden from screen readers on purpose; the tests look at them all the same.
configure({ defaultIncludeHiddenElements: true });

const NOW = Date.now();
const ME: Me = {
  userId: '0190f7a4-1111-7111-8111-000000000001',
  username: 'seko',
  displayName: 'Seko',
  avatar: null,
  device: { id: '0190f7a4-1111-7111-8111-000000000002', platform: 'android', attested: true },
  passkeys: 0,
};
const BOB = '0190f7a4-3333-7333-8333-000000000003';
const CEM = '0190f7a4-4444-7444-8444-000000000004';
const member = (userId: string, name: string): Circle['members'][number] => ({
  userId,
  role: 'member',
  status: 'active',
  username: name.toLowerCase(),
  displayName: name,
  avatar: null,
  device: null,
});
const CIRCLE: Circle = {
  id: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  kind: 'friends',
  name: null,
  epoch: 1,
  epochStartedAt: NOW,
  myRole: 'member',
  myStatus: 'active',
  members: [member(ME.userId, 'Seko'), member(BOB, 'Bob'), member(CEM, 'Cem')],
};
const here = (userId: string, lat: number) => ({
  circleId: CIRCLE.id,
  userId,
  receivedAt: NOW,
  loc: { kind: 'loc' as const, lat, lng: 28.97, acc: 8, bat: 80, chg: false, ts: NOW },
});

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  useLocations.setState({}, true);
  useLooks.setState({}, true);
  useMyFix.setState({ fix: null, since: null });
  useMyLook.setState({ look: null });
  // Close enough to read the street: people standing apart are apart on the screen too.
  useMapZoom.setState({ zoom: 16 });
});

describe('looks on the pins of the map, the user’s own and friends’ (docs/ADR/0025)', () => {
  it('draws a friend’s look on their pin, and a plain pin for the one who has none', async () => {
    useLocations.setState({
      [`${CIRCLE.id}:${BOB}`]: here(BOB, 41.0),
      [`${CIRCLE.id}:${CEM}`]: here(CEM, 41.2),
    });
    useLooks.setState({ [BOB]: { ring: 'dots', frame: 'gold', until: NOW + 86_400_000, ts: 1 } });
    await render(<PeopleLayer me={ME} circles={[CIRCLE]} />);
    const pins = screen.getAllByTestId('pin-look');
    expect(pins).toHaveLength(1);
    expect(within(nth(pins)).getByTestId('pin-look-ring-dots')).toBeTruthy();
    expect(within(nth(pins)).getByTestId('pin-look-frame-gold')).toBeTruthy();
    // Both pins are on the map: only Bob's wears anything.
    expect(screen.getAllByTestId('marker-live')).toHaveLength(2);
  });

  it('shows a look only until its pass runs out', async () => {
    useLocations.setState({ [`${CIRCLE.id}:${BOB}`]: here(BOB, 41.0) });
    useLooks.setState({ [BOB]: { ring: 'dots', until: NOW - 1, ts: 1 } });
    await render(<PeopleLayer me={ME} circles={[CIRCLE]} />);
    expect(screen.queryByTestId('pin-look')).toBeNull();
  });

  it('draws the user’s own look on their own pin', async () => {
    useMyFix.setState({
      fix: { lat: 41.0, lng: 28.97, acc: 8, ts: NOW, spd: 0, hdg: null },
      since: null,
    });
    useMyLook.setState({ look: { ring: 'gradient', frame: 'dashed', until: NOW + 86_400_000 } });
    await render(<PeopleLayer me={ME} circles={[CIRCLE]} />);
    expect(screen.getByTestId('pin-look-ring-gradient')).toBeTruthy();
    expect(screen.getByTestId('pin-look-frame-dashed')).toBeTruthy();
  });

  it('draws the look of each around their own face in a pin shared by people standing together', async () => {
    // Bob stands where the user is: one shared pin; the owner wants their frame seen there too
    // (2026-10-29).
    useMyFix.setState({
      fix: { lat: 41.0, lng: 28.97, acc: 8, ts: NOW, spd: 0, hdg: null },
      since: null,
    });
    useLocations.setState({ [`${CIRCLE.id}:${BOB}`]: here(BOB, 41.0) });
    useMyLook.setState({ look: { ring: 'stripes', until: NOW + 86_400_000 } });
    useLooks.setState({ [BOB]: { frame: 'neon', until: NOW + 86_400_000, ts: 1 } });
    await render(
      <EffectsPaused.Provider value>
        <PeopleLayer me={ME} circles={[CIRCLE]} />
      </EffectsPaused.Provider>,
    );
    expect(screen.getAllByTestId('pin-look')).toHaveLength(2);
    expect(screen.getByTestId('pin-look-ring-stripes')).toBeTruthy();
    expect(screen.getByTestId('pin-look-frame-neon')).toBeTruthy();
  });
});

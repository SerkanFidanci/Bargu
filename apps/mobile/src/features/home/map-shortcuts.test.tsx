import type { Circle } from '@bargu/schemas';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockSayArrived = jest.fn<Promise<void>, [unknown, number]>(() => Promise.resolve());
const mockUpdateSharing = jest.fn<undefined, [(current: SharingSettings) => SharingSettings]>(
  (change) => {
    useSharing.setState(change(useSharing.getState()), true);
  },
);
jest.mock('@/features/location/location-session', () => ({
  sayArrived: (circle: unknown, meetAt: number) => mockSayArrived(circle, meetAt),
  updateSharing: (change: never) => {
    mockUpdateSharing(change);
  },
}));

import { MapShortcuts } from '@/features/home/map-shortcuts';
import { useMyFix } from '@/features/location/engine';
import { DEFAULT_SHARING, type SharingSettings, useSharing } from '@/features/location/sharing';
import type { Place } from '@/features/places/place-model';
import { useArrived } from '@/features/plan/meeting';

const ME = '0190f7a4-1111-7111-8111-000000000001';
const MIN = 60_000;
const NOW = 1_000 * MIN;
const family: Circle = {
  id: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  kind: 'family',
  name: 'Aile',
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [],
};
const home: Place = {
  id: '0190f7a4-2222-7222-8222-000000000001',
  circleId: family.id,
  version: 1,
  name: 'Ev',
  emoji: '🏠',
  lat: 41.03,
  lng: 28.95,
  radius: 100,
  ts: 1,
};
const shortcuts = (props: Partial<Parameters<typeof MapShortcuts>[0]> = {}) => (
  <MapShortcuts
    circles={[family]}
    away={false}
    onRecenter={jest.fn()}
    meeting={null}
    me={ME}
    now={NOW}
    bottom={0}
    shared={false}
    {...props}
  />
);

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  useSharing.setState(DEFAULT_SHARING, true);
  useArrived.setState({}, true);
  useMyFix.setState({ fix: null });
});

describe('the map shortcuts (docs/ADR/0026 §8)', () => {
  it('turn ghost mode on in one tap, and off only after saying what gets shared again', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(shortcuts());
    const ghost = screen.getByTestId('shortcut-ghost');
    expect(ghost.props.accessibilityLabel).toBe(i18n.t('map.shortcuts.ghostOff'));
    await fireEvent.press(ghost);
    expect(useSharing.getState().ghost).toBe('hide');
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByTestId('shortcut-ghost').props.accessibilityLabel).toBe(
      i18n.t('map.shortcuts.ghostOn'),
    );
    expect(screen.getByTestId('shortcut-ghost').props.accessibilityState).toEqual({
      selected: true,
    });

    // Off: asked first, with how many circles get the location again; nothing until "Share".
    await fireEvent.press(screen.getByTestId('shortcut-ghost'));
    expect(useSharing.getState().ghost).toBe('hide');
    expect(alert).toHaveBeenCalledWith(
      i18n.t('map.shortcuts.ghostOffTitle'),
      'Konumun yeniden paylaşılacak: 1 çember.',
      expect.any(Array),
    );
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    await act(() => {
      buttons.find((button) => button.style !== 'cancel')?.onPress?.();
    });
    expect(useSharing.getState().ghost).toBe('off');
    alert.mockRestore();
  });

  it('wear a violet dot only while the location really goes to someone, and say so', async () => {
    const view = await render(shortcuts({ shared: true }));
    expect(screen.getByTestId('ghost-shared-dot')).toBeTruthy();
    expect(screen.getByTestId('shortcut-ghost').props.accessibilityLabel).toContain(
      'Konumun paylaşılıyor.',
    );
    // A ghost, every circle paused, sharing off, nobody, no permission: sharingNow says so.
    await view.rerender(shortcuts({ shared: false }));
    expect(screen.queryByTestId('ghost-shared-dot')).toBeNull();
    expect(screen.getByTestId('shortcut-ghost').props.accessibilityLabel).not.toContain(
      'Konumun paylaşılıyor.',
    );
  });

  it('turn ghost mode off at once when no circle would get the location', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useSharing.setState({ ghost: 'freeze', circles: {} }, true);
    await render(shortcuts({ circles: [] }));
    await fireEvent.press(screen.getByTestId('shortcut-ghost'));
    expect(alert).not.toHaveBeenCalled();
    expect(useSharing.getState().ghost).toBe('off');
    alert.mockRestore();
  });

  it('offer back to me when away, a meeting when none is on, and "Geldim" near one', async () => {
    const view = await render(shortcuts());
    expect(screen.queryByTestId('shortcut-recenter')).toBeNull();
    expect(screen.getByTestId('shortcut-meet')).toBeTruthy();
    const onRecenter = jest.fn();
    await view.rerender(shortcuts({ away: true, onRecenter }));
    await fireEvent.press(screen.getByTestId('shortcut-recenter'));
    expect(onRecenter).toHaveBeenCalled();

    // A meeting in an hour, this phone far away: no "start", no "Geldim" yet.
    const meeting = { circle: family, meetAt: NOW + 60 * MIN, place: home };
    await view.rerender(shortcuts({ meeting }));
    expect(screen.queryByTestId('shortcut-meet')).toBeNull();
    expect(screen.queryByTestId('shortcut-here')).toBeNull();
    // Its time: "Geldim", once.
    await view.rerender(shortcuts({ meeting, now: meeting.meetAt }));
    await fireEvent.press(screen.getByTestId('shortcut-here'));
    expect(mockSayArrived).toHaveBeenCalledWith(family, meeting.meetAt);
    await act(() => {
      useArrived.setState({ [`${family.id}:${ME}`]: { meetAt: meeting.meetAt, ts: NOW } });
    });
    await view.rerender(shortcuts({ meeting, now: meeting.meetAt + MIN }));
    expect(screen.queryByTestId('shortcut-here')).toBeNull();
  });
});

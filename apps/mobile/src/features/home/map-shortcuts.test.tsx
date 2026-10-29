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
// The store's button has its own tests (store-button.test.tsx).
jest.mock('./store-button', () => ({ StoreButton: () => null }));
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
  it('offer the three ghost choices of Me, by the same names, the icon alone on the map', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(shortcuts());
    const ghost = screen.getByTestId('shortcut-ghost');
    expect(ghost.props.accessibilityLabel).toBe('Hayalet modu: Kapalı. Değiştirmek için dokun.');
    // No words beside it (the owner, 2026-10-29): the button itself says it.
    expect(screen.queryByText('Hayalet')).toBeNull();
    await fireEvent.press(ghost);
    expect(
      ['off', 'freeze', 'hide'].map(
        (mode) =>
          String(screen.getByTestId(`ghost-${mode}`).props.accessibilityLabel).split('.')[0],
      ),
    ).toEqual(['Kapalı', 'Dondur', 'Gizle']);
    expect(String(screen.getByTestId('ghost-off').props.accessibilityLabel)).toContain('Seçili');

    // "Gizle": off everyone's map, nothing asked.
    await fireEvent.press(screen.getByTestId('ghost-hide'));
    expect(useSharing.getState().ghost).toBe('hide');
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByTestId('shortcut-ghost').props.accessibilityLabel).toBe(
      'Hayalet modu: Gizle. Değiştirmek için dokun.',
    );
    expect(screen.getByTestId('shortcut-ghost').props.accessibilityState).toEqual({
      selected: true,
    });
    // Not by colour alone (the PM, 2026-10-29): a crossed-out eye for "Gizle".
    expect(screen.getByTestId('ghost-badge-hide', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('ghost-badge-freeze', { includeHiddenElements: true })).toBeNull();
    // "Dondur": the last location stays.
    await fireEvent.press(screen.getByTestId('ghost-freeze'));
    expect(useSharing.getState().ghost).toBe('freeze');
    expect(screen.getByTestId('shortcut-ghost').props.accessibilityLabel).toBe(
      'Hayalet modu: Dondur. Değiştirmek için dokun.',
    );
    // A snowflake for "Dondur".
    expect(screen.getByTestId('ghost-badge-freeze', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('ghost-badge-hide', { includeHiddenElements: true })).toBeNull();

    // "Kapalı": asked first, with how many circles get the location again; nothing until "Share".
    await fireEvent.press(screen.getByTestId('ghost-off'));
    expect(useSharing.getState().ghost).toBe('freeze');
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
    // Off: no badge of a ghost at all.
    expect(screen.queryByTestId(/^ghost-badge-/, { includeHiddenElements: true })).toBeNull();
    alert.mockRestore();
  });

  it('wear a navy dot only while the location really goes to someone, and say so', async () => {
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
    await fireEvent.press(screen.getByTestId('ghost-off'));
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

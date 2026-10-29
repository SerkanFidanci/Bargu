import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import i18n from '@/i18n';

import { LocationBanner } from './location-banner';
import { router } from 'expo-router';

import { DEFAULT_SHARING, useSharing, useSharingUnreadable } from './sharing';
import { useLocationPermission, useLocationServices } from './tracker';
import { useMyWhy } from './why';

// What friends see when the permission or the location services go off, and the quiet way to hide
// instead (QA-33 N-2, docs/ADR/0028).

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../live/live-session', () => ({
  useConnection: (select: (state: { online: boolean; drops: number }) => unknown) =>
    select({ online: true, drops: 0 }),
}));
jest.mock('./tracker', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    useLocationPermission: create(() => ({ state: 'undetermined' })),
    useLocationServices: create(() => ({ state: 'on' })),
    requestLocationPermission: jest.fn(() => Promise.resolve('granted')),
  };
});
// The one ghost path the map button uses too: it changes the sharing settings through the session.
jest.mock('./location-session', () => {
  const sharing = jest.requireActual<typeof import('./sharing')>('./sharing');
  return {
    updateSharing: (
      change: (current: typeof sharing.DEFAULT_SHARING) => typeof sharing.DEFAULT_SHARING,
    ) => {
      sharing.useSharing.setState(change(sharing.useSharing.getState()), true);
    },
  };
});
const mockToast = jest.fn<undefined, [string]>();
jest.mock('@/ui/toast', () => ({
  toast: {
    info: (message: string) => {
      mockToast(message);
    },
  },
}));

const SINCE = new Date(2026, 9, 1, 14, 20).getTime();
const tell = (why: 'saver' | 'permission' | 'nofix') => {
  useMyWhy.setState({ current: { why, since: SINCE } }, true);
};
const PERMISSION_HINT =
  'Arkadaşların “Konum izni kapalı” görür. Sessizce gizlenmek için hayalet modu kullan.';
const SERVICES_HINT =
  'Arkadaşların “Konum alınamıyor” görür. Sessizce gizlenmek için hayalet modu kullan.';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockToast.mockClear();
  useSharing.setState(DEFAULT_SHARING, true);
  useLocationPermission.setState({ state: 'granted' });
  useLocationServices.setState({ state: 'on' });
  useMyWhy.setState({ current: null }, true);
  useSharingUnreadable.setState({ unreadable: false });
});

describe('sharing settings that could not be read (the PM, 2026-10-29)', () => {
  it('says the location goes to nobody for now, first, and opens the settings to check', async () => {
    useLocationPermission.setState({ state: 'blocked' });
    useSharingUnreadable.setState({ unreadable: true });
    await render(<LocationBanner />);
    expect(screen.getByText('Paylaşım ayarların okunamadı')).toBeTruthy();
    expect(screen.queryByTestId('location-permission')).toBeNull();
    await fireEvent.press(screen.getByTestId('sharing-unreadable-check'));
    expect(router.push).toHaveBeenCalledWith('/settings/location');
    expect(useSharingUnreadable.getState().unreadable).toBe(false);
    expect(screen.queryByTestId('sharing-unreadable')).toBeNull();
  });
});

describe('the permission card says what friends see, and offers the quiet way', () => {
  it('says "Konum izni kapalı" is what they see, once refused for good, with ghost mode in one tap', async () => {
    useLocationPermission.setState({ state: 'blocked' });
    tell('permission');
    await render(<LocationBanner />);
    expect(screen.getByTestId('location-permission')).toBeTruthy();
    expect(screen.getByText(PERMISSION_HINT)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ghost-hint-on'));
    // The same path as the map\'s ghost button: hide, and the same line of confirmation.
    expect(useSharing.getState().ghost).toBe('hide');
    expect(mockToast).toHaveBeenCalledWith(i18n.t('map.shortcuts.ghostOnToast'));
  });

  it('says it too when the permission was taken back and not yet refused for good', async () => {
    useLocationPermission.setState({ state: 'undetermined' });
    tell('permission');
    await render(<LocationBanner />);
    expect(screen.getByText(PERMISSION_HINT)).toBeTruthy();
    // The question itself is still there.
    expect(screen.getByTestId('location-continue')).toBeTruthy();
  });

  it('says nothing of it before any friend holds a location of this phone (the first question)', async () => {
    useLocationPermission.setState({ state: 'undetermined' });
    await render(<LocationBanner />);
    expect(screen.getByTestId('location-permission')).toBeTruthy();
    expect(screen.queryByTestId('ghost-hint')).toBeNull();
  });

  it('goes with the ghost: once it is on, friends are told nothing and the hint is gone', async () => {
    useLocationPermission.setState({ state: 'blocked' });
    tell('permission');
    await render(<LocationBanner />);
    await fireEvent.press(screen.getByTestId('ghost-hint-on'));
    // The reporter stops telling the circles when the ghost starts (state-report.ts).
    await act(() => {
      useMyWhy.setState({ current: null });
    });
    expect(screen.queryByTestId('ghost-hint')).toBeNull();
    // And a ghost already on needs no button even if a reason were still shown.
    await act(() => {
      useSharing.setState({ ...DEFAULT_SHARING, ghost: 'freeze' }, true);
      tell('permission');
    });
    expect(screen.queryByTestId('ghost-hint')).toBeNull();
  });
});

describe('the services card says what friends see, and offers the quiet way', () => {
  it('shows with the services off while friends hear of it, with the settings and ghost mode', async () => {
    useLocationServices.setState({ state: 'off' });
    tell('nofix');
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(<LocationBanner />);
    expect(screen.getByTestId('location-services')).toBeTruthy();
    expect(screen.getByText('Telefonunun konumu kapalı')).toBeTruthy();
    expect(screen.getByText(SERVICES_HINT)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('location-services-settings'));
    expect(open).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('ghost-hint-on'));
    expect(useSharing.getState().ghost).toBe('hide');
    expect(mockToast).toHaveBeenCalledWith(i18n.t('map.shortcuts.ghostOnToast'));
    open.mockRestore();
  });

  it('does not show when nobody is told (services off for a phone that shares with no one)', async () => {
    useLocationServices.setState({ state: 'off' });
    await render(<LocationBanner />);
    expect(screen.queryByTestId('location-services')).toBeNull();
    expect(screen.queryByTestId('location-permission')).toBeNull();
  });

  it('does not show with the services on, though "no position" is what friends are told', async () => {
    // Silence without the services off (indoors, no sky): not something to switch on.
    tell('nofix');
    await render(<LocationBanner />);
    expect(screen.queryByTestId('location-services')).toBeNull();
  });

  it('leaves the front to the permission card when both apply', async () => {
    useLocationServices.setState({ state: 'off' });
    useLocationPermission.setState({ state: 'blocked' });
    tell('permission');
    await render(<LocationBanner />);
    expect(screen.getByTestId('location-permission')).toBeTruthy();
    expect(screen.queryByTestId('location-services')).toBeNull();
  });
});

describe('in English', () => {
  it('says the same, with the English words for what friends see', async () => {
    await i18n.changeLanguage('en');
    useLocationPermission.setState({ state: 'blocked' });
    tell('permission');
    const view = await render(<LocationBanner />);
    try {
      expect(
        screen.getByText(
          'Your friends see “Location permission off”. To hide quietly, use ghost mode.',
        ),
      ).toBeTruthy();
      expect(screen.getByText('Turn on ghost mode')).toBeTruthy();
      await act(() => {
        useLocationPermission.setState({ state: 'granted' });
        useLocationServices.setState({ state: 'off' });
        tell('nofix');
      });
      expect(screen.getByText("Your phone's location is off")).toBeTruthy();
      expect(
        screen.getByText(
          "Your friends see “Can't get a location”. To hide quietly, use ghost mode.",
        ),
      ).toBeTruthy();
    } finally {
      // Off the screen first: a language change under a mounted screen is an update outside act().
      await view.unmount();
      await i18n.changeLanguage('tr');
    }
  });
});

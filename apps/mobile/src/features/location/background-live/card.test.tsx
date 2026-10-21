import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import {
  DEFAULT_SHARING,
  type SharingSettings,
  useSharing,
  withAdultDefaults,
  withMinorSharing,
} from '../sharing';
import { memoryStore } from '../test-support';
import { BackgroundLiveCard } from './card';
import { cardSeen, useCardSeen } from './notice-card';
import { BackgroundLiveRow } from './row';

const mockStore = memoryStore();
const mockPush = jest.fn<undefined, [unknown]>();

// Native modules jest does not have on Linux (CI), though Windows resolves them.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => {
      mockPush(route);
    },
  },
}));
jest.mock('../../storage/vault', () => ({ isVaultOpen: () => true, vault: () => mockStore }));
jest.mock('../location-session', () => {
  const { useSharing: sharing } = jest.requireActual<typeof import('../sharing')>('../sharing');
  return {
    updateSharing: (change: (current: SharingSettings) => SharingSettings) => {
      sharing.setState(change(sharing.getState()), true);
    },
  };
});

const CARD =
  'Biri haritada sana bakarken konumun birkaç dakika daha sık gider; pil biraz daha harcanır. Ayarlardan kapatabilirsin.';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockPush.mockClear();
  mockStore.clear();
  useCardSeen.setState({ seen: true });
  useSharing.setState(withAdultDefaults(DEFAULT_SHARING), true);
});

describe('the one-time explanation (docs/ADR/0028 step 3)', () => {
  it('says, in the PM’s words, that the location goes more often while someone looks', async () => {
    await render(<BackgroundLiveCard />);
    expect(screen.getByTestId('background-live-card')).toBeTruthy();
    expect(screen.getByText(CARD)).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(
      screen.getByText(
        'While someone looks at you on the map, your location is sent more often for a few minutes; it uses a bit more battery. You can turn it off in settings.',
      ),
    ).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
  });

  it('shows once for an adult, and never again after "Tamam"', async () => {
    await render(<BackgroundLiveCard />);
    expect(cardSeen(mockStore)).toBe(false);
    await fireEvent.press(screen.getByTestId('background-live-card-ok'));
    expect(screen.queryByTestId('background-live-card')).toBeNull();
    expect(cardSeen(mockStore)).toBe(true);
    // A restart: the memory forgets, the vault remembers.
    await screen.unmount();
    useCardSeen.setState({ seen: false });
    await render(<BackgroundLiveCard />);
    expect(screen.queryByTestId('background-live-card')).toBeNull();
  });

  it('opens the location settings from the card, and counts as seen', async () => {
    await render(<BackgroundLiveCard />);
    await fireEvent.press(screen.getByTestId('background-live-card-settings'));
    expect(mockPush).toHaveBeenCalledWith('/settings/location');
    expect(cardSeen(mockStore)).toBe(true);
  });

  it('does not show for a teen, whose setting starts off', async () => {
    useSharing.setState(withMinorSharing(DEFAULT_SHARING, []), true);
    await render(<BackgroundLiveCard />);
    expect(screen.queryByTestId('background-live-card')).toBeNull();
  });

  it('does not show for a phone that has not been told its age band, or with the setting off', async () => {
    useSharing.setState(DEFAULT_SHARING, true);
    await render(<BackgroundLiveCard />);
    expect(screen.queryByTestId('background-live-card')).toBeNull();
    await act(() => {
      useSharing.setState({ ...withAdultDefaults(DEFAULT_SHARING), backgroundLive: 'off' }, true);
    });
    expect(screen.queryByTestId('background-live-card')).toBeNull();
  });
});

describe('the "Arka planda canlı konum" row in the location settings', () => {
  it('shows the setting with its battery note, on for an adult', async () => {
    await render(<BackgroundLiveRow />);
    const toggle = screen.getByTestId('background-live-toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText('Arka planda canlı konum')).toBeTruthy();
    expect(screen.getByText(/Pil biraz daha harcanır/)).toBeTruthy();
  });

  it('is off for a teen until the teen turns it on, and back off with the switch', async () => {
    useSharing.setState(withMinorSharing(DEFAULT_SHARING, []), true);
    await render(<BackgroundLiveRow />);
    const toggle = screen.getByTestId('background-live-toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(toggle);
    expect(useSharing.getState().backgroundLive).toBe('on');
    expect(screen.getByTestId('background-live-toggle').props.accessibilityState).toMatchObject({
      checked: true,
    });
    await fireEvent.press(screen.getByTestId('background-live-toggle'));
    expect(useSharing.getState().backgroundLive).toBe('off');
  });

  it('counts as seeing the setting: the card does not come after', async () => {
    useCardSeen.setState({ seen: false });
    await render(<BackgroundLiveRow />);
    expect(cardSeen(mockStore)).toBe(true);
    expect(useCardSeen.getState().seen).toBe(true);
  });
});

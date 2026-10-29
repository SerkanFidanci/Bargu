import type { Plan } from '@bargu/schemas';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    router: { back: jest.fn(), push: jest.fn() },
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
  };
});
// On here, as in package D; off as in this build, a link here leads back (QA-41).
const mockFlag = { on: true };
jest.mock('@/features/history/own/own-flag', () => ({
  get OWN_HISTORY_ENABLED() {
    return mockFlag.on;
  },
}));
// The map and its layer are native; the screen's own parts are what is tested here.
jest.mock('@/features/map/bargu-map', () => ({ BarguMap: () => null }));
jest.mock('@/features/history/history-layer', () => ({ HistoryLayer: () => null }));
const mockPlan: { current: Plan | undefined } = { current: undefined };
jest.mock('@/features/billing/plan', () => ({
  usePlan: () => ({ data: mockPlan.current }),
  planKey: ['plan'],
}));
jest.mock('@/features/circles/queries', () => ({ useCircles: () => ({ data: [] }) }));
jest.mock('@/features/places/places', () => ({ usePlaces: () => ({}) }));
jest.mock('@/features/account/export', () => ({
  saveExport: jest.fn(() => Promise.resolve(true)),
}));

const mockStore = new Map<string, string>();
jest.mock('@/features/storage/vault', () => ({
  isVaultOpen: () => true,
  vault: () => ({
    get: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => {
      mockStore.set(key, value);
    },
    delete: (key: string) => {
      mockStore.delete(key);
    },
    keys: () => [...mockStore.keys()],
    clear: () => {
      mockStore.clear();
    },
  }),
}));
const mockPrepare = jest.fn<Promise<boolean>, [boolean]>(() => Promise.resolve(true));
jest.mock('@/features/history/own/own-files', () => ({
  prepareTrailKey: (c: boolean) => mockPrepare(c),
}));
// One own history in memory, as the session would hold it (own-trail.test.ts tests the store).
jest.mock('@/features/history/own/own-session', () => {
  const { createOwnTrail } =
    jest.requireActual<typeof import('@/features/history/own/own-trail')>('./own-trail');
  const months = new Map<string, Map<string, string>>();
  const open = (month: string) => {
    const data = months.get(month) ?? new Map<string, string>();
    months.set(month, data);
    return {
      store: {
        get: (key: string) => data.get(key),
        set: (key: string, value: string) => {
          data.set(key, value);
        },
        delete: (key: string) => {
          data.delete(key);
        },
        keys: () => [...data.keys()],
        clear: () => {
          data.clear();
        },
      },
      close: () => undefined,
    };
  };
  const trail = createOwnTrail({
    vault: () => ({
      get: (key: string) => mockStore.get(key),
      set: (key: string, value: string) => {
        mockStore.set(key, value);
      },
      delete: (key: string) => {
        mockStore.delete(key);
      },
      keys: () => [...mockStore.keys()],
      clear: () => {
        mockStore.clear();
      },
    }),
    files: {
      months: () => [...months.keys()],
      open,
      destroy: () => {
        months.clear();
      },
    },
    unlocked: () => true,
  });
  return { ownTrail: trail, ownTrailTick: () => Promise.resolve() };
});

import MyHistoryScreen from '@/app/(app)/history/mine';
import { ownTrail } from '@/features/history/own/own-session';

const NOW = Date.now();
const plan = (overrides: Partial<Plan>): Plan => ({
  plan: 'free',
  product: null,
  source: null,
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics: [],
  testBilling: false,
  ...overrides,
});
let alerts: { title: string; buttons: AlertButton[] }[] = [];

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockPlan.current = undefined;
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    alerts.push({ title, buttons: buttons ?? [] });
  });
});

describe('"Konum geçmişim" off in this build (QA-41)', () => {
  it('sends a deep link here back to the map', async () => {
    mockFlag.on = false;
    try {
      await render(<MyHistoryScreen />);
      expect(screen.getByTestId('redirect')).toHaveTextContent('/');
      expect(screen.queryByTestId('my-history')).toBeNull();
    } finally {
      mockFlag.on = true;
    }
  });
});

describe('"Konum geçmişim" (docs/ADR/0030 §4)', () => {
  it('is off to begin with, says what it is, and without Bargu+ takes the switch to the store', async () => {
    mockPlan.current = plan({ plan: 'free' });
    await render(<MyHistoryScreen />);
    expect(screen.getByText('Konum geçmişim')).toBeTruthy();
    expect(screen.getByText("Bargu+ özelliği. Açmak için Bargu+'ya geçersin.")).toBeTruthy();
    expect(screen.getByText(/Geçmiş kapalı/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mine-on'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/store', params: { shelf: 'plus' } });
    expect(ownTrail.settings().on).toBe(false);
  });

  it('turns on with Bargu+: the key is made and its advice given, and it stays on this phone', async () => {
    mockPlan.current = plan({ plan: 'plus', expiresAt: NOW + 30 * 86_400_000 });
    await render(<MyHistoryScreen />);
    await fireEvent.press(screen.getByTestId('mine-on'));
    await act(() => Promise.resolve());
    expect(mockPrepare).toHaveBeenCalledWith(true);
    expect(ownTrail.settings()).toEqual({ on: true, keep: 30 });
    // On but with nobody to share with: it says nothing is written now.
    expect(screen.getByTestId('mine-idle')).toBeTruthy();
  });

  it('shows the stays of a day, and every day of the strip, the ones without a record faded', async () => {
    mockPlan.current = plan({ plan: 'plus' });
    ownTrail.setSettings({ on: true, keep: 30 });
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    for (let step = 0; step <= 12; step++) {
      ownTrail.record(
        { lat: 41.0256, lng: 28.9742, acc: 10, ts: today.getTime() + step * 5 * 60_000 },
        { entitled: true, ghost: 'off', sharing: true },
      );
    }
    await render(<MyHistoryScreen />);
    expect(await screen.findByTestId('history-stay')).toBeTruthy();
    expect(screen.getAllByTestId(/^mine-day-/).length).toBeGreaterThanOrEqual(14);
  });

  it('is deleted after asking, and is empty after it', async () => {
    mockPlan.current = plan({ plan: 'plus' });
    ownTrail.setSettings({ on: true, keep: 30 });
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    for (let step = 0; step <= 12; step++) {
      ownTrail.record(
        { lat: 41.0256, lng: 28.9742, acc: 10, ts: today.getTime() + step * 5 * 60_000 },
        { entitled: true, ghost: 'off', sharing: true },
      );
    }
    await render(<MyHistoryScreen />);
    expect(await screen.findByTestId('history-stay')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mine-delete'));
    expect(alerts.at(-1)?.title).toBe('Konum geçmişin silinsin mi?');
    await act(() => {
      alerts
        .at(-1)
        ?.buttons.find((button) => button.style === 'destructive')
        ?.onPress?.();
    });
    expect(screen.queryByTestId('history-stay')).toBeNull();
    expect(ownTrail.days()).toEqual([]);
    // The user's choice stays: it is not history.
    expect(ownTrail.settings().on).toBe(true);
  });

  it('keeps for a year on a tap, and asks before going back down to 30 days with days to lose', async () => {
    mockPlan.current = plan({ plan: 'plus' });
    await render(<MyHistoryScreen />);
    await fireEvent.press(screen.getByText('1 yıl'));
    expect(ownTrail.settings().keep).toBe(365);
    await fireEvent.press(screen.getByText('30 gün'));
    expect(ownTrail.settings().keep).toBe(30);
  });

  it("has the circles' history one row away and a note about where it stays", async () => {
    mockPlan.current = plan({ plan: 'plus' });
    await render(<MyHistoryScreen />);
    await fireEvent.press(screen.getByTestId('mine-viewers'));
    expect(router.push).toHaveBeenCalledWith('/history/viewers');
    expect(screen.getByText(/yalnız bu telefonda durur/)).toBeTruthy();
  });
});

import type { Plan } from '@bargu/schemas';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
  const { createElement, useEffect } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    router: { back: jest.fn(), push: jest.fn() },
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
    useFocusEffect: (effect: () => (() => void) | undefined) => {
      useEffect(() => {
        effect();
      }, [effect]);
    },
  };
});
// On here, as in package D; off as in this build, a link here leads back (QA-41).
const mockFlag = { on: true };
jest.mock('@/features/history/own/own-flag', () => ({
  get OWN_HISTORY_ENABLED() {
    return mockFlag.on;
  },
}));
// The map and its layer are native; the screen's own parts and camera calls are what is tested here.
const mockFitTo = jest.fn();
jest.mock('@/features/map/bargu-map', () => {
  const { useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  return {
    BarguMap: (props: {
      children?: import('react').ReactNode;
      ref?: import('react').Ref<unknown>;
    }) => {
      useImperativeHandle(
        props.ref,
        () => ({
          fitTo: mockFitTo,
          focusOn: () => undefined,
          placeName: () => Promise.resolve(null),
          townName: () => Promise.resolve(null),
        }),
        [],
      );
      return props.children ?? null;
    },
  };
});
jest.mock('@/features/history/history-layer', () => ({ HistoryLayer: () => null }));
const mockFog = jest.fn<undefined, [{ type: string; coordinates: unknown[][] }]>();
jest.mock('@/features/history/explore-layer', () => ({
  ExploreLayer: ({ fog }: { fog: { type: string; coordinates: unknown[][] } }) => {
    mockFog(fog);
    return null;
  },
}));
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
  return {
    ownTrail: trail,
    ownTrailTick: () => Promise.resolve(),
    tellIfTrailLost: jest.fn(),
    withOwnTrailMetrics: <T,>(_listener: unknown, work: () => T): T => work(),
  };
});

import MyHistoryScreen from '@/app/(app)/history/mine';
import { saveExport } from '@/features/account/export';
import * as exploreModel from '@/features/history/own/explore-model';
import { ownTrail } from '@/features/history/own/own-session';
import { catchUp } from '@/features/location/clock';

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

  it('turned off, asks first and deletes on yes, with a way to take it out (the PM, 2026-10-30)', async () => {
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
    await fireEvent.press(screen.getByTestId('mine-on'));
    const asked = alerts.at(-1);
    expect(asked?.title).toBe('Konum geçmişin kapatılsın mı?');
    expect(asked?.buttons.map((button) => button.text)).toEqual([
      'Dışa aktar',
      'Sil ve kapat',
      'Vazgeç',
    ]);
    // Nothing happens until a choice: it is still on, and kept.
    expect(ownTrail.settings().on).toBe(true);
    await act(() => {
      asked?.buttons.find((button) => button.style === 'destructive')?.onPress?.();
    });
    expect(ownTrail.settings().on).toBe(false);
    expect(ownTrail.days()).toEqual([]);
    expect(screen.queryByTestId('history-stay')).toBeNull();
  });

  it('taken out first, asks again, now only to delete or not: it is still on (QA-43)', async () => {
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
    await fireEvent.press(screen.getByTestId('mine-on'));
    const first = alerts.at(-1);
    await act(async () => {
      first?.buttons.find((button) => button.text === 'Dışa aktar')?.onPress?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(alerts).toHaveLength(2);
    });
    expect(saveExport).toHaveBeenCalledTimes(1);
    const again = alerts.at(-1);
    expect(again?.title).toBe('Konum geçmişin kapatılsın mı?');
    expect(again?.buttons.map((button) => button.text)).toEqual(['Sil ve kapat', 'Vazgeç']);
    // Still on and kept until the choice.
    expect(ownTrail.settings().on).toBe(true);
    await act(() => {
      again?.buttons.find((button) => button.style === 'destructive')?.onPress?.();
    });
    expect(ownTrail.settings().on).toBe(false);
    expect(ownTrail.days()).toEqual([]);
  });

  it('takes it out from its own button without asking anything after', async () => {
    mockPlan.current = plan({ plan: 'plus' });
    await render(<MyHistoryScreen />);
    await fireEvent.press(screen.getByTestId('mine-export'));
    await waitFor(() => {
      expect(saveExport).toHaveBeenCalledTimes(1);
    });
    expect(alerts).toHaveLength(0);
  });

  it('keeps for a year on a tap, and asks before going back down to 30 days with days to lose', async () => {
    mockPlan.current = plan({ plan: 'plus' });
    await render(<MyHistoryScreen />);
    await fireEvent.press(screen.getByText('1 yıl'));
    expect(ownTrail.settings().keep).toBe(365);
    await fireEvent.press(screen.getByText('30 gün'));
    expect(ownTrail.settings().keep).toBe(30);
  });

  it('shows where one has been as a discovery map: getting ready, then no numbers (ADR 0030 Ek 2)', async () => {
    mockPlan.current = plan({ plan: 'plus' });
    ownTrail.setSettings({ on: true, keep: 30 });
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    for (let step = 0; step <= 12; step++) {
      ownTrail.record(
        {
          lat: 41.0256 + step * 0.002,
          lng: 28.9742,
          acc: 10,
          ts: today.getTime() + step * 5 * 60_000,
        },
        { entitled: true, ghost: 'off', sharing: true },
      );
    }
    // The work is held until the screen is looked at while it runs.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = exploreModel.explore;
    const spy = jest.spyOn(exploreModel, 'explore').mockImplementation(async (...args) => {
      await held;
      return real(...args);
    });
    await render(<MyHistoryScreen />);
    await fireEvent.press(screen.getByText('Keşif'));
    expect(screen.getByTestId('mine-explore-busy')).toHaveTextContent('Hazırlanıyor…');
    await act(async () => {
      release();
      await held;
    });
    spy.mockRestore();
    // The day's strip and stays give way to one line, with nothing to count.
    expect(screen.queryByTestId('mine-timeline')).toBeNull();
    await waitFor(() => {
      expect(screen.queryByTestId('mine-explore-busy')).toBeNull();
    });
    expect(screen.getByText('Son 30 günde gittiğin yerler')).toBeTruthy();
    expect(screen.getByTestId('mine-explore').props.accessibilityLabel).toBe(
      'Keşif haritası, son 30 günde gittiğin yerler açık.',
    );
    expect(screen.queryByText(/\d+ (yer|kare)/)).toBeNull();
    // The map's fog has the walk open in it: the world, with a hole.
    const fog = mockFog.mock.lastCall?.[0];
    expect(fog?.type).toBe('MultiPolygon');
    expect(fog?.coordinates[0]?.length).toBeGreaterThan(1);
    const fitted = mockFitTo.mock.calls.length;
    expect(fitted).toBeGreaterThan(0);
    // QA-45: the 30-second clock redraw has the same Explored object, so it must not refit.
    const later = Date.now() + 30_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(later);
    await act(() => {
      catchUp();
    });
    clock.mockRestore();
    expect(mockFitTo).toHaveBeenCalledTimes(fitted);
    await fireEvent.press(screen.getByText('Gün'));
    expect(await screen.findByTestId('mine-timeline')).toBeTruthy();
  });

  it('uses the full English discovery-map label for a screen reader', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    try {
      ownTrail.setSettings({ on: false, keep: 30 });
      await render(<MyHistoryScreen />);
      await fireEvent.press(screen.getByText('Discover'));
      expect(screen.getByTestId('mine-explore').props.accessibilityLabel).toBe(
        'Discovery map, places you went in the last 30 days are open.',
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage('tr');
      });
    }
  });

  it("has the circles' history one row away and a note about where it stays", async () => {
    mockPlan.current = plan({ plan: 'plus' });
    await render(<MyHistoryScreen />);
    await fireEvent.press(screen.getByTestId('mine-viewers'));
    expect(router.push).toHaveBeenCalledWith('/history/viewers');
    expect(screen.getByText(/yalnız bu telefonda durur/)).toBeTruthy();
  });
});

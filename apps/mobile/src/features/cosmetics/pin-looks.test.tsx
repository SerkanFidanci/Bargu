import type { Me, Plan } from '@bargu/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { ApiError } from '@/features/auth/api-client';
import i18n from '@/i18n';
import { lightColors } from '@/theme/colors';
import { useToasts } from '@/ui/toast';

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
// ui/screen imports expo-router; this screen never navigates.
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
// Watches the battery (expo-battery, native): not what is tested here.
jest.mock('@/features/home/effect-prefs', () => ({ setEffectLevel: jest.fn() }));

const ME: Me = {
  userId: '0190f7a4-1111-7111-8111-000000000001',
  username: 'seko',
  displayName: 'Seko',
  avatar: null,
  device: { id: '0190f7a4-1111-7111-8111-000000000002', platform: 'android', attested: true },
  passkeys: 0,
};
const plan = (cosmetics: string[], testBilling = true, pendingCosmetics?: string[]): Plan => ({
  plan: 'free',
  product: null,
  source: null,
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics,
  testBilling,
  ...(pendingCosmetics === undefined ? {} : { pendingCosmetics }),
});
let mockPlan: Plan = plan([]);
let mockBand: '18+' | '15-17' = '18+';
const mockPurchase = jest.fn<Promise<Plan>, [string]>();
const mockChoose = jest.fn<Promise<void>, [{ ring: string | null; frame: string | null }]>();
const mockRefresh = jest.fn<Promise<void>, [boolean | undefined]>();

jest.mock('@/features/billing/billing-api', () => ({
  billingApi: { testPurchase: (product: string) => mockPurchase(product) },
}));
jest.mock('@/features/billing/plan', () => {
  const { useQuery } =
    jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    planKey: ['plan'],
    usePlan: () => useQuery({ queryKey: ['plan'], queryFn: () => Promise.resolve(mockPlan) }),
  };
});
jest.mock('@/features/account/age-api', () => ({
  ageKey: ['age'],
  fetchAge: () => Promise.resolve({ age: { band: mockBand, method: 'self' } }),
  isMinor: (state: { age?: { band?: string } } | undefined) => state?.age?.band === '15-17',
}));
jest.mock('@/features/profile/queries', () => ({ useMe: () => ({ data: ME }) }));
// The choice and the pass live in the encrypted vault and go to circles: look-session.test.ts.
jest.mock('./look-session', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const useMyLook = create(() => ({
    choice: { ring: null as string | null, frame: null as string | null },
    pass: null,
    look: null,
  }));
  return {
    useMyLook,
    chooseLook: (choice: { ring: string | null; frame: string | null }) => {
      useMyLook.setState({ choice });
      return mockChoose(choice);
    },
    refreshPass: (force?: boolean) => mockRefresh(force),
  };
});

import LookSettingsScreen from '@/app/(app)/settings/look';

import { useMyLook } from './look-session';

/** The flattened style of a rendered element (the test renderer types props loosely). */
const styleOf = (element: { props: unknown }): ViewStyle & TextStyle =>
  StyleSheet.flatten((element.props as { style?: StyleProp<ViewStyle & TextStyle> }).style);

/** The cache of the screen shown last: a plan arriving over the event stream is put into it. */
let cache: QueryClient;
const show = async () => {
  cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const view = await render(
    <QueryClientProvider client={cache}>
      <LookSettingsScreen />
    </QueryClientProvider>,
  );
  // The plan and the age arrive: a pack to buy, a pack the account has, or no buying yet.
  await waitFor(() => {
    expect(
      screen.queryByTestId('pack-buy-rings') ??
        screen.queryByTestId('pack-pending-rings') ??
        screen.queryByText('Sende') ??
        screen.queryAllByText(/yakında|gerekiyor/)[0],
    ).toBeTruthy();
  });
  return view;
};
const preview = () => within(screen.getByTestId('pin-look-preview'));

// The pin's look is hidden from screen readers on purpose; the tests look at it all the same.
configure({ defaultIncludeHiddenElements: true });

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = plan([]);
  mockBand = '18+';
  mockPurchase.mockImplementation(() => Promise.resolve(plan(['rings'])));
  mockChoose.mockImplementation(() => Promise.resolve());
  mockRefresh.mockImplementation(() => Promise.resolve());
  useMyLook.setState({ choice: { ring: null, frame: null }, pass: null, look: null });
  useToasts.setState({ current: null });
});

describe('"Pin süsleri" in Görünüm ve harita (docs/ADR/0025, the pin addendum)', () => {
  it('shows the own pin and the two packs with their styles', async () => {
    await show();
    expect(await screen.findByText('Pin süsleri')).toBeTruthy();
    expect(screen.getByTestId('pin-look-preview')).toBeTruthy();
    expect(within(screen.getByTestId('pack-rings')).getByText('Halka desenleri')).toBeTruthy();
    expect(within(screen.getByTestId('pack-frames')).getByText('Pin çerçeveleri')).toBeTruthy();
    for (const style of [
      'stripes',
      'dots',
      'gradient',
      'sparkle',
      'holo',
      'gold',
      'neon',
      'dashed',
    ]) {
      expect(screen.getByTestId(`style-${style}`)).toBeTruthy();
    }
    expect(screen.getByTestId('style-rings-plain')).toBeTruthy();
    // No look yet: the pin is plain.
    expect(screen.queryByTestId('pin-look')).toBeNull();
  });

  it('keeps the name under the pin readable', async () => {
    await show();
    const name = within(screen.getByTestId('pin-look-preview')).getByText('Seko');
    expect(styleOf(name).color).toBe(lightColors.text);
  });

  it('lets a style of a pack not bought be tried on the pin: shown, never chosen or sent', async () => {
    await show();
    await screen.findByTestId('pack-buy-rings');
    await fireEvent.press(screen.getByTestId('style-sparkle'));
    expect(preview().getByTestId('pin-look-ring-sparkle')).toBeTruthy();
    expect(screen.getByTestId('style-sparkle').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByText('Deniyorsun: satın alınca arkadaşların da görür.')).toBeTruthy();
    expect(mockChoose).not.toHaveBeenCalled();
    // The plain one takes it off again.
    await fireEvent.press(screen.getByTestId('style-rings-plain'));
    expect(preview().queryByTestId('pin-look-ring-sparkle')).toBeNull();
  });

  it('buys a pack with a test purchase, says it is a test, and chooses the style that was tried', async () => {
    await show();
    await fireEvent.press(await screen.findByTestId('style-gradient'));
    expect(
      within(screen.getByTestId('pack-rings')).getByText('TEST — gerçek ödeme yok'),
    ).toBeTruthy();
    expect(within(screen.getByTestId('pack-rings')).getByText('Paketi al · ₺29,99')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pack-buy-rings'));
    await waitFor(() => {
      expect(mockPurchase).toHaveBeenCalledWith('cosmetic:rings');
    });
    // The new pack goes into the next pass at once, and the style tried is chosen and sent.
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledWith(true);
      expect(mockChoose).toHaveBeenCalledWith({ ring: 'gradient', frame: null });
    });
    expect(await screen.findByText('Sende')).toBeTruthy();
    expect(screen.queryByTestId('pack-buy-rings')).toBeNull();
    // The other pack is still to buy.
    expect(screen.getByTestId('pack-buy-frames')).toBeTruthy();
    expect(useToasts.getState().current?.tone).toBe('success');
  });

  it('chooses a style of a pack the account has, at once, and the plain one takes it off', async () => {
    mockPlan = plan(['rings']);
    await show();
    await screen.findByText('Sende');
    expect(screen.queryByTestId('pack-buy-rings')).toBeNull();
    await fireEvent.press(screen.getByTestId('style-dots'));
    expect(mockChoose).toHaveBeenLastCalledWith({ ring: 'dots', frame: null });
    expect(preview().getByTestId('pin-look-ring-dots')).toBeTruthy();
    // A frame is another pack: not owned, so only tried.
    await fireEvent.press(screen.getByTestId('style-gold'));
    expect(mockChoose).toHaveBeenCalledTimes(1);
    expect(preview().getByTestId('pin-look-frame-gold')).toBeTruthy();
    expect(preview().getByTestId('pin-look-ring-dots')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('style-rings-plain'));
    expect(mockChoose).toHaveBeenLastCalledWith({ ring: null, frame: null });
    expect(preview().queryByTestId('pin-look-ring-dots')).toBeNull();
  });

  it('says that the moving styles stop in calm mode, in battery saving and with Reduce Motion', async () => {
    await show();
    const hints = await screen.findAllByText(/durur/);
    expect(hints.length).toBeGreaterThan(0);
  });

  it('asks a parent instead of buying for 15-17, and shows the pack waiting for their yes', async () => {
    mockBand = '15-17';
    mockPurchase.mockRejectedValueOnce(new ApiError(403, 'GUARDIAN_APPROVAL'));
    await show();
    await waitFor(() => {
      expect(screen.getByTestId('pack-buy-rings')).toBeTruthy();
    });
    expect(screen.getAllByText('Ebeveynime sor · ₺29,99')).toHaveLength(2);
    expect(screen.queryByText('Paketi al · ₺29,99')).toBeNull();
    expect(screen.queryByTestId('pack-pending-rings')).toBeNull();
    await fireEvent.press(screen.getByTestId('pack-buy-rings'));
    await waitFor(() => {
      expect(mockPurchase).toHaveBeenCalledWith('cosmetic:rings');
    });
    // Not an error: the request is made (ADR 0025 §6) and the pack waits; nothing bought, nothing
    // chosen.
    await waitFor(() => {
      expect(useToasts.getState().current?.message).toBe(
        'Ebeveynine sordun. Onaylayınca paket açılır ve haber alırsın.',
      );
    });
    expect(useToasts.getState().current?.tone).toBe('success');
    const rings = within(screen.getByTestId('pack-rings'));
    expect(await rings.findByTestId('pack-pending-rings')).toBeTruthy();
    expect(rings.getByText('Onay bekliyor')).toBeTruthy();
    expect(rings.getByText(/Ebeveyninin onayı bekleniyor/)).toBeTruthy();
    // It cannot be asked twice from here, and the other pack is still to ask for.
    expect(screen.queryByTestId('pack-buy-rings')).toBeNull();
    expect(screen.getByTestId('pack-buy-frames')).toBeTruthy();
    expect(within(screen.getByTestId('pack-frames')).queryByText('Onay bekliyor')).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockChoose).not.toHaveBeenCalled();
  });

  it('keeps a pack waiting when the other is asked for, and shows what waits from the plan', async () => {
    mockBand = '15-17';
    mockPlan = plan([], true, ['rings']);
    mockPurchase.mockRejectedValueOnce(new ApiError(403, 'GUARDIAN_APPROVAL'));
    await show();
    // Opened again later (or on another phone): the plan says rings wait.
    expect(await screen.findByTestId('pack-pending-rings')).toBeTruthy();
    expect(screen.queryByTestId('pack-buy-rings')).toBeNull();
    await fireEvent.press(screen.getByTestId('pack-buy-frames'));
    await waitFor(() => {
      expect(mockPurchase).toHaveBeenCalledWith('cosmetic:frames');
    });
    expect(await screen.findByTestId('pack-pending-frames')).toBeTruthy();
    // Asking for one never clears the other.
    expect(screen.getByTestId('pack-pending-rings')).toBeTruthy();
    expect(mockPurchase).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when a parent says no, and may ask again', async () => {
    mockBand = '15-17';
    mockPlan = plan([], true, ['frames']);
    await show();
    expect(await screen.findByTestId('pack-pending-frames')).toBeTruthy();
    // plan.changed brought the plan again: nothing waits any more.
    await act(() => {
      cache.setQueryData(['plan'], plan([], true, []));
    });
    expect(await screen.findByTestId('pack-buy-frames')).toBeTruthy();
    expect(screen.queryByTestId('pack-pending-frames')).toBeNull();
    expect(screen.queryByText('Onay bekliyor')).toBeNull();
  });

  it('shows the pack as theirs when a parent says yes: nothing waits, styles are chosen at once', async () => {
    mockBand = '15-17';
    mockPlan = plan([], true, ['rings']);
    await show();
    expect(await screen.findByTestId('pack-pending-rings')).toBeTruthy();
    // A style of the waiting pack can be tried meanwhile: shown, never sent.
    await fireEvent.press(screen.getByTestId('style-sparkle'));
    expect(preview().getByTestId('pin-look-ring-sparkle')).toBeTruthy();
    expect(mockChoose).not.toHaveBeenCalled();
    // The parent's yes arrives over the event stream (plan.changed): the plan has the pack.
    await act(() => {
      cache.setQueryData(['plan'], plan(['rings'], true, []));
    });
    expect(await screen.findByText('Sende')).toBeTruthy();
    expect(screen.queryByTestId('pack-pending-rings')).toBeNull();
    expect(screen.queryByText('Onay bekliyor')).toBeNull();
    // The style that was tried was never chosen, so the pin does not show it any more: friends
    // would not see it either.
    expect(preview().queryByTestId('pin-look-ring-sparkle')).toBeNull();
    expect(mockChoose).not.toHaveBeenCalled();
    // The pack is theirs now: a style is chosen at once and goes to circles, as for anyone.
    await fireEvent.press(screen.getByTestId('style-dots'));
    expect(mockChoose).toHaveBeenLastCalledWith({ ring: 'dots', frame: null });
    expect(preview().getByTestId('pin-look-ring-dots')).toBeTruthy();
  });

  it('tells a 15-17 account with no parent linked that a parent is needed, and shows nothing waiting', async () => {
    mockBand = '15-17';
    mockPurchase.mockRejectedValueOnce(new ApiError(403, 'GUARDIAN_LINK_REQUIRED'));
    await show();
    await fireEvent.press(await screen.findByTestId('pack-buy-rings'));
    await waitFor(() => {
      expect(useToasts.getState().current?.tone).toBe('error');
    });
    expect(useToasts.getState().current?.message).toMatch(/ebeveyn/i);
    // The button's loading state ends in the query cache's next tick.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId('pack-pending-rings')).toBeNull();
    expect(screen.getByTestId('pack-buy-rings')).toBeTruthy();
  });

  it('never shows an adult a pack as waiting, whatever the plan says', async () => {
    mockPlan = plan([], true, ['rings']);
    await show();
    expect(await screen.findByTestId('pack-buy-rings')).toBeTruthy();
    expect(screen.queryByTestId('pack-pending-rings')).toBeNull();
    expect(screen.queryByText('Onay bekliyor')).toBeNull();
  });

  it('offers no purchase where the server has no test billing, nor to 15-17 there', async () => {
    mockPlan = plan([], false);
    const { unmount } = await show();
    expect(
      await screen.findAllByText('Satın alma yakında: mağaza bağlantısı henüz yok.'),
    ).toHaveLength(2);
    expect(screen.queryByTestId('pack-buy-rings')).toBeNull();
    await unmount();
    mockBand = '15-17';
    await show();
    expect(await screen.findAllByText(/ebeveyn onayı gerekiyor/)).toHaveLength(2);
    expect(screen.queryByTestId('pack-buy-rings')).toBeNull();
  });

  it('shows an error when buying fails otherwise, and keeps the pack to buy', async () => {
    mockPurchase.mockRejectedValueOnce(new ApiError(500, 'INTERNAL'));
    await show();
    await fireEvent.press(await screen.findByTestId('pack-buy-frames'));
    await waitFor(() => {
      expect(useToasts.getState().current?.tone).toBe('error');
    });
    expect(screen.getByTestId('pack-buy-frames')).toBeTruthy();
  });
});

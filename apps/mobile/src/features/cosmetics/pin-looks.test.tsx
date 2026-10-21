import type { Me, Plan } from '@bargu/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
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
const plan = (cosmetics: string[], testBilling = true): Plan => ({
  plan: 'free',
  product: null,
  source: null,
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics,
  testBilling,
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

const show = async () => {
  const view = await render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { gcTime: Infinity },
          },
        })
      }
    >
      <LookSettingsScreen />
    </QueryClientProvider>,
  );
  // The plan and the age arrive: a pack to buy, a pack the account has, or no buying yet.
  await waitFor(() => {
    expect(
      screen.queryByTestId('pack-buy-rings') ??
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

  it('asks a parent instead of buying for 15-17, and says a parent must say yes', async () => {
    mockBand = '15-17';
    mockPurchase.mockRejectedValueOnce(new ApiError(403, 'GUARDIAN_APPROVAL'));
    await show();
    await waitFor(() => {
      expect(screen.getByTestId('pack-buy-rings')).toBeTruthy();
    });
    expect(screen.getAllByText('Ebeveynime sor · ₺29,99')).toHaveLength(2);
    expect(screen.queryByText('Paketi al · ₺29,99')).toBeNull();
    await fireEvent.press(screen.getByTestId('pack-buy-rings'));
    await waitFor(() => {
      expect(mockPurchase).toHaveBeenCalledWith('cosmetic:rings');
    });
    // Not an error: the pack waits for a parent (ADR 0025 §6), nothing bought, nothing chosen.
    await waitFor(() => {
      expect(useToasts.getState().current?.message).toBe('Bu paket için ebeveyn onayı gerekiyor.');
    });
    expect(useToasts.getState().current?.tone).toBe('info');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockChoose).not.toHaveBeenCalled();
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

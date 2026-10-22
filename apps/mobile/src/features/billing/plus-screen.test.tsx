import type { Plan } from '@bargu/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError } from '@/features/auth/api-client';
import { useTestBilling } from '@/features/billing/test-slot';
import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// ui/screen imports expo-router; this screen never navigates.
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

const DAY = 86_400_000;
const trial = (testBilling: boolean): Plan => ({
  plan: 'trial',
  product: 'trial',
  source: 'bargu',
  expiresAt: Date.now() + 10 * DAY,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: Date.now() + 10 * DAY,
  cosmetics: [],
  testBilling,
});
const yearly: Plan = {
  ...trial(true),
  plan: 'plus',
  product: 'plus_year',
  source: 'test',
  expiresAt: Date.now() + 365 * DAY,
  autoRenew: true,
  trialEndsAt: null,
};
let mockPlan: Plan = trial(true);
let mockBand: '18+' | '15-17' = '18+';
const mockPurchase = jest.fn<Promise<Plan>, [string]>(() => Promise.resolve(yearly));
const mockSimulate = jest.fn<Promise<Plan>, [string]>(() =>
  Promise.resolve({ ...yearly, autoRenew: false }),
);
jest.mock('@/features/billing/billing-api', () => ({
  billingApi: { plan: () => Promise.resolve(mockPlan) },
}));
// A development or preview build has test billing in its slot (features/billing/test-billing.ts); a
// production build leaves the slot empty (the tests below say which).
const withTestBilling = () => {
  useTestBilling.setState({
    api: {
      purchase: (product) => mockPurchase(product),
      simulate: (action) => mockSimulate(action),
    },
  });
};
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

import PlusScreen from '@/app/(app)/plus';

const show = () =>
  render(
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
      <PlusScreen />
    </QueryClientProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = trial(true);
  mockBand = '18+';
  withTestBilling();
});
afterEach(() => {
  useTestBilling.setState({ api: null });
});

describe('Bargu+ (docs/ADR/0024 §9)', () => {
  it('says it is a test, offers the yearly plan first and buys with no payment', async () => {
    await show();
    expect(await screen.findByTestId('plus-test-band')).toBeTruthy();
    expect(screen.getByText('TEST — gerçek ödeme yok')).toBeTruthy();
    expect(screen.getByText(/Deneme: 10 gün kaldı/)).toBeTruthy();
    expect(screen.getByTestId('plus-plus_year').props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByTestId('plus-buy'));
    await waitFor(() => {
      expect(mockPurchase).toHaveBeenCalledWith('plus_year');
    });
    // Subscribed by test: the offers go, cancelling is one tap.
    await fireEvent.press(await screen.findByTestId('plus-cancel'));
    await waitFor(() => {
      expect(mockSimulate).toHaveBeenCalledWith('cancel');
    });
  });

  it('offers no purchase where the server has no test billing, nor to 15-17', async () => {
    mockPlan = trial(false);
    await show();
    expect(await screen.findByText('Yakında Google Play üzerinden')).toBeTruthy();
    expect(screen.queryByTestId('plus-test-band')).toBeNull();
    expect(screen.queryByTestId('plus-buy')).toBeNull();
  });

  it('in English says the same: coming soon through Google Play', async () => {
    mockPlan = trial(false);
    await i18n.changeLanguage('en');
    const { unmount } = await show();
    expect(await screen.findByText('Coming soon through Google Play')).toBeTruthy();
    // Back to Turkish only once the screen is gone (a mounted screen would re-draw outside act).
    await unmount();
    await i18n.changeLanguage('tr');
  });

  describe('in a production build (no test billing in its bundle)', () => {
    beforeEach(() => {
      useTestBilling.setState({ api: null });
    });

    it('says coming soon through Google Play and offers no purchase, even if the server says test billing is on', async () => {
      mockPlan = trial(true);
      await show();
      expect(await screen.findByText('Yakında Google Play üzerinden')).toBeTruthy();
      expect(screen.queryByTestId('plus-test-band')).toBeNull();
      expect(screen.queryByTestId('plus-buy')).toBeNull();
      expect(mockPurchase).not.toHaveBeenCalled();
      expect(mockSimulate).not.toHaveBeenCalled();
    });

    it('does not offer a 15-17 account to ask a parent either: nothing could be bought', async () => {
      mockBand = '15-17';
      mockPlan = trial(true);
      await show();
      expect(await screen.findByText(/ebeveyn onayı gerekiyor/)).toBeTruthy();
      expect(screen.queryByTestId('plus-ask')).toBeNull();
      expect(mockPurchase).not.toHaveBeenCalled();
    });

    it('offers no cancel for a plan an old test build started', async () => {
      mockPlan = yearly;
      await show();
      expect(await screen.findByTestId('plus-status')).toBeTruthy();
      expect(screen.queryByTestId('plus-cancel')).toBeNull();
      expect(mockSimulate).not.toHaveBeenCalled();
    });
  });

  it('lets a 15-17 account ask a parent instead of buying (docs/ADR/0024 §5)', async () => {
    mockBand = '15-17';
    mockPurchase.mockRejectedValueOnce(new ApiError(403, 'GUARDIAN_APPROVAL'));
    await show();
    expect(screen.queryByTestId('plus-buy')).toBeNull();
    await fireEvent.press(await screen.findByTestId('plus-ask'));
    await waitFor(() => {
      expect(mockPurchase).toHaveBeenCalledWith('plus_year');
    });
  });

  it('shows a 15-17 account the plan waiting for a parent, and lets them ask for the other', async () => {
    mockBand = '15-17';
    mockPlan = { ...trial(true), pendingPurchase: 'plus_year' };
    await show();
    expect(await screen.findByText('Ebeveyninin onayı bekleniyor: Bargu+ yıllık.')).toBeTruthy();
    expect(screen.queryByTestId('plus-ask')).toBeNull();
    await fireEvent.press(screen.getByTestId('plus-plus_month'));
    expect(await screen.findByText('Bunun yerine aylık iste')).toBeTruthy();
  });

  it('tells 15-17 that buying is not here yet where the server has no test billing', async () => {
    mockBand = '15-17';
    mockPlan = trial(false);
    await show();
    expect(await screen.findByText(/ebeveyn onayı gerekiyor/)).toBeTruthy();
    expect(screen.queryByTestId('plus-ask')).toBeNull();
  });
});

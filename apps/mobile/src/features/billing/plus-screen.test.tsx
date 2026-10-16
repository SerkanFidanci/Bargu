import type { Plan } from '@bargu/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  billingApi: {
    plan: () => Promise.resolve(mockPlan),
    testPurchase: (product: string) => mockPurchase(product),
    simulate: (action: string) => mockSimulate(action),
  },
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
    expect(await screen.findByText(/Satın alma yakında/)).toBeTruthy();
    expect(screen.queryByTestId('plus-test-band')).toBeNull();
    expect(screen.queryByTestId('plus-buy')).toBeNull();
  });

  it('asks a 15-17 account for a parent instead of a button', async () => {
    mockBand = '15-17';
    await show();
    expect(await screen.findByText(/ebeveyn onayı gerekiyor/)).toBeTruthy();
    expect(screen.queryByTestId('plus-buy')).toBeNull();
  });
});

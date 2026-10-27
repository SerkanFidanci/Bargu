import type { Plan } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

const mockPush = jest.fn<undefined, [unknown]>();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => {
      mockPush(route);
    },
  },
}));
const DAY = 86_400_000;
const mockNow = Date.UTC(2026, 9, 27, 12);
jest.mock('../location/clock', () => ({ useNow: () => mockNow }));
let mockPlan: Plan | undefined;
jest.mock('../billing/plan', () => ({ usePlan: () => ({ data: mockPlan }) }));

import { StoreButton } from './store-button';

const plan = (over: Partial<Plan>): Plan => ({
  plan: 'free',
  product: null,
  source: 'bargu',
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics: [],
  testBilling: false,
  ...over,
});

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockPush.mockClear();
});

describe('the store button on the map (docs/ADR/0025 Ek 2)', () => {
  it('invites to Bargu+ without it and opens the store', async () => {
    mockPlan = plan({});
    await render(<StoreButton level="full" />);
    expect(screen.getByText('Mağaza')).toBeTruthy();
    expect(screen.getByText('Bargu+’a geç')).toBeTruthy();
    expect(screen.getByLabelText('Mağaza: Bargu+’a geç')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('shortcut-store'));
    expect(mockPush).toHaveBeenLastCalledWith('/store');
  });

  it('counts the trial down, and shows the pin looks to those who have Bargu+', async () => {
    mockPlan = plan({ plan: 'trial', product: 'trial', trialEndsAt: mockNow + 5 * DAY });
    const trial = await render(<StoreButton level="reduced" />);
    expect(screen.getByText('Deneme: 5 gün')).toBeTruthy();
    await trial.unmount();
    mockPlan = plan({ plan: 'plus', product: 'plus_year', expiresAt: mockNow + 300 * DAY });
    await render(<StoreButton level="off" />);
    expect(screen.getByText('Yeni pin süsleri')).toBeTruthy();
  });
});

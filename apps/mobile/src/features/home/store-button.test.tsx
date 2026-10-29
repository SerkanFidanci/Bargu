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
    expect(screen.getByLabelText('Mağaza: Bargu+’a geç')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('shortcut-store'));
    expect(mockPush).toHaveBeenLastCalledWith('/store');
  });

  it('counts the trial down, and offers the pin looks to those who have Bargu+, read out', async () => {
    mockPlan = plan({ plan: 'trial', product: 'trial', trialEndsAt: mockNow + 5 * DAY });
    const trial = await render(<StoreButton level="reduced" />);
    expect(screen.getByLabelText('Mağaza: Deneme: 5 gün')).toBeTruthy();
    await trial.unmount();
    mockPlan = plan({ plan: 'plus', product: 'plus_year', expiresAt: mockNow + 300 * DAY });
    await render(<StoreButton level="off" />);
    expect(screen.getByLabelText('Mağaza: Yeni pin süsleri')).toBeTruthy();
  });
});

describe('its size (the owner, 2026-10-29: "Mağaza ekranda çok yer kaplıyor")', () => {
  it('is a round button as large as the shortcuts, its sweep drawn at that size, no words on it', async () => {
    mockPlan = plan({});
    await render(<StoreButton level="off" />);
    expect(screen.getByTestId('store-band').props).toMatchObject({ width: 48, height: 48 });
    expect(screen.queryByText('Mağaza')).toBeNull();
    expect(screen.queryByText('Bargu+’a geç')).toBeNull();
  });
});

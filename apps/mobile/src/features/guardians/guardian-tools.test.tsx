import type { GuardianView } from '@bargu/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// ui/screen imports expo-router, whose native stack needs a native view jest does not have on
// Linux (CI); the tools never navigate.
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockAnswer = jest.fn(() => Promise.resolve());
const mockSettings = jest.fn();
jest.mock('./guardians-api', () => ({
  guardiansKey: ['guardians'],
  guardianViewKey: (id: string) => ['guardians', 'view', id],
  guardiansApi: {
    answer: (...args: unknown[]) => mockAnswer(...(args as [])),
    setSettings: (...args: unknown[]) => mockSettings(...(args as [])) as unknown,
  },
}));

import { GuardianTools } from './guardian-tools';

const LINK = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const REQUEST = '0190f7a4-5b6c-7d8e-9f01-23456789abce';
const PURCHASE = '0190f7a4-5b6c-7d8e-9f01-23456789abcf';
const COSMETIC = '0190f7a4-5b6c-7d8e-9f01-23456789abd0';
const NEWER_PACK = '0190f7a4-5b6c-7d8e-9f01-23456789abd1';
const view = (role: 'child' | 'guardian'): GuardianView => ({
  link: {
    id: LINK,
    role,
    status: 'active',
    other: { username: role === 'child' ? 'anne' : 'deniz', displayName: null, avatar: null },
    createdAt: 1,
    activeAt: 2,
    endRequestedAt: null,
    endsAt: null,
  },
  child: { username: 'deniz', displayName: 'Deniz', avatar: null },
  ageBand: '15-17',
  circles: [],
  settings: { approveNewPeople: true, dailyLimitMinutes: 60, updatedAt: 3, updatedBy: 'anne' },
  usage: [{ day: '2026-10-15', minutes: 42 }],
  requests: [
    { id: REQUEST, kind: 'group', name: 'Kulüp', memberCount: 4, by: 'Fikret', createdAt: 4 },
    {
      id: PURCHASE,
      kind: 'purchase',
      name: null,
      memberCount: null,
      by: null,
      product: 'plus_year',
      createdAt: 5,
    },
    // A look pack beside Bargu+ (docs/ADR/0025 §6), and one this app has never heard of.
    {
      id: COSMETIC,
      kind: 'cosmetic',
      name: null,
      memberCount: null,
      by: null,
      pack: 'rings',
      createdAt: 6,
    },
    {
      id: NEWER_PACK,
      kind: 'cosmetic',
      name: null,
      memberCount: null,
      by: null,
      pack: 'seasonal_7',
      createdAt: 7,
    },
  ],
});

const show = (role: 'child' | 'guardian') =>
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
      <GuardianTools view={view(role)} />
    </QueryClientProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
});

describe('guardian tools on the shared view (docs/ADR/0023 §5)', () => {
  it('let a parent answer and see the minutes', async () => {
    await show('guardian');
    expect(screen.getByText('Grup: Kulüp (4 kişi), davet eden Fikret')).toBeTruthy();
    expect(screen.getByText('42 dk')).toBeTruthy();
    // The child asks for Bargu+ (docs/ADR/0024 §5): the plan; its price only as the store gives
    // it, none before (QA-42).
    expect(screen.getByText('Bargu+ yıllık almak istiyor')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`guardian-approve-${REQUEST}`));
    await waitFor(() => {
      expect(mockAnswer).toHaveBeenCalledWith(LINK, REQUEST, true);
    });
  });

  it('show a parent a look pack by its name, beside the Bargu+ request, and let them answer each', async () => {
    await show('guardian');
    // Both are there, apart: the plan and its price, the pack and its price.
    expect(screen.getByText(/^Bargu\+ yıllık almak istiyor/)).toBeTruthy();
    expect(screen.getByText('“Halka desenleri” süs paketini almak istiyor (₺29,99)')).toBeTruthy();
    // A pack this app does not know is worded in general, with no price it cannot know.
    expect(screen.getByText('Yeni bir süs paketi almak istiyor')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`guardian-approve-${COSMETIC}`));
    await waitFor(() => {
      expect(mockAnswer).toHaveBeenCalledWith(LINK, COSMETIC, true);
    });
    await fireEvent.press(screen.getByTestId(`guardian-decline-${NEWER_PACK}`));
    await waitFor(() => {
      expect(mockAnswer).toHaveBeenLastCalledWith(LINK, NEWER_PACK, false);
    });
  });

  it('word a look pack in English too', async () => {
    await i18n.changeLanguage('en');
    const view = await show('guardian');
    try {
      expect(screen.getByText('Wants the “Ring patterns” look pack (TRY 29.99)')).toBeTruthy();
      expect(screen.getByText('Wants a new look pack')).toBeTruthy();
      expect(screen.getByText(/^Wants Bargu\+ yearly/)).toBeTruthy();
    } finally {
      // Off the screen first: a language change under a mounted screen is an update outside act().
      await view.unmount();
      await i18n.changeLanguage('tr');
    }
  });

  it("show the child the same, without the parent's buttons", async () => {
    await show('child');
    expect(screen.getByText('Grup: Kulüp (4 kişi), davet eden Fikret')).toBeTruthy();
    expect(screen.getByText('“Halka desenleri” süs paketini almak istiyor (₺29,99)')).toBeTruthy();
    expect(screen.getAllByText('Ebeveyninin onayını bekliyor.')).toHaveLength(4);
    expect(screen.queryByTestId(`guardian-approve-${COSMETIC}`)).toBeNull();
    expect(screen.queryByTestId(`guardian-approve-${REQUEST}`)).toBeNull();
    expect(screen.queryByTestId('guardian-approve-new')).toBeNull();
    expect(screen.getByText('Günlük süre sınırı: 60 dk')).toBeTruthy();
    expect(screen.getByText(/Son değiştiren: @anne/)).toBeTruthy();
  });
});

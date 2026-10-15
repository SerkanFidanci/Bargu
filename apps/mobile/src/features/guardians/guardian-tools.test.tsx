import type { GuardianView } from '@bargu/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
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
    { id: REQUEST, kind: 'group', name: 'Kulüp', memberCount: 4, by: 'fikret', createdAt: 4 },
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
    expect(screen.getByText('Grup: Kulüp (4 kişi), davet eden @fikret')).toBeTruthy();
    expect(screen.getByText('42 dk')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`guardian-approve-${REQUEST}`));
    await waitFor(() => {
      expect(mockAnswer).toHaveBeenCalledWith(LINK, REQUEST, true);
    });
  });

  it("show the child the same, without the parent's buttons", async () => {
    await show('child');
    expect(screen.getByText('Grup: Kulüp (4 kişi), davet eden @fikret')).toBeTruthy();
    expect(screen.getByText('Ebeveyninin onayını bekliyor.')).toBeTruthy();
    expect(screen.queryByTestId(`guardian-approve-${REQUEST}`)).toBeNull();
    expect(screen.queryByTestId('guardian-approve-new')).toBeNull();
    expect(screen.getByText('Günlük süre sınırı: 60 dk')).toBeTruthy();
    expect(screen.getByText(/Son değiştiren: @anne/)).toBeTruthy();
  });
});

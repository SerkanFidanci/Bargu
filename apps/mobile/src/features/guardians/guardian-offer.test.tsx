import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError } from '@/features/auth/api-client';
import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));

const mockToken = 'A'.repeat(42) + 'b';
const mockPreview = jest.fn();
const mockAccept = jest.fn();
jest.mock('@/features/guardians/guardians-api', () => ({
  guardiansKey: ['guardians'],
  guardiansApi: {
    preview: (token: string) => mockPreview(token) as unknown,
    accept: (token: string) => mockAccept(token) as unknown,
  },
}));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) as unknown, back: jest.fn() },
  useLocalSearchParams: () => ({ token: mockToken }),
}));

import GuardianOfferScreen from '@/app/(app)/g/[token]';

const show = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}
    >
      <GuardianOfferScreen />
    </QueryClientProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
});

describe("a parent opens a child's code (docs/ADR/0023 §4)", () => {
  it("says whose it is, what they will and will not see, then sends the parent's yes", async () => {
    mockPreview.mockResolvedValue({
      child: { username: 'deniz', displayName: 'Deniz', avatar: null },
    });
    mockAccept.mockResolvedValue({});
    await show();
    expect(await screen.findByText('Deniz seni ebeveyni olarak eklemek istiyor.')).toBeTruthy();
    expect(screen.getByText(/ebeveyn bağlantısı bunları açmaz/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guardian-accept'));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/guardians');
    });
    expect(mockPreview).toHaveBeenCalledWith(mockToken);
    expect(mockAccept).toHaveBeenCalledWith(mockToken);
  });

  it('tells someone under 18 that only an adult can be a parent', async () => {
    mockPreview.mockRejectedValue(new ApiError(403, 'GUARDIAN_ADULT_ONLY'));
    await show();
    expect(
      await screen.findByText('Ebeveyn olarak yalnızca 18 yaş ve üstü bağlanabilir.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('guardian-accept')).toBeNull();
  });
});

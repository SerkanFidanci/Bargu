import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));

const mockForget = jest.fn<Promise<'off' | 'later'>, []>(() => Promise.resolve('off'));
const mockSetHistory = jest.fn(() => Promise.resolve());
jest.mock('@/features/location/location-session', () => ({
  forgetAllHistory: () => mockForget(),
  setHistory: () => mockSetHistory(),
}));
const mockConsent = jest.fn(() =>
  Promise.resolve({ notice: null, history: { version: 1, at: 1 } }),
);
jest.mock('@/features/account/account-api', () => ({
  privacyKey: ['privacy'],
  setHistoryConsent: () => mockConsent(),
}));

let mockLeave: (() => void) | null = null;
const mockBack = jest.fn(() => mockLeave?.());
jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
  useLocalSearchParams: () => ({ review: '1' }),
  useNavigation: () => ({
    addListener: (_event: string, listener: () => void) => {
      mockLeave = listener;
      return () => {
        mockLeave = null;
      };
    },
  }),
}));

import HistoryConsentScreen from '@/app/(app)/consent';

const show = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        })
      }
    >
      <HistoryConsentScreen />
    </QueryClientProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockLeave = null;
});

describe('asking those who had history on (docs/ADR/0022)', () => {
  it('takes closing it without an answer as no: history goes off once (QA 4 K4)', async () => {
    await show();
    await act(async () => {
      mockLeave?.();
      await Promise.resolve();
    });
    expect(mockForget).toHaveBeenCalledTimes(1);
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it('keeps history on when consent is given, and does not turn it off on the way out', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('consent-give'));
    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });
    expect(mockConsent).toHaveBeenCalledTimes(1);
    expect(mockForget).not.toHaveBeenCalled();
  });
});

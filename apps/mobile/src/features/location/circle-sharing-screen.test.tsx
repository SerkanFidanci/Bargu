import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen } from '@testing-library/react-native';

import CirclePlacesScreen from '@/app/(app)/circle/[id]/places';
import CircleSharingScreen from '@/app/(app)/circle/[id]/sharing';
import i18n from '@/i18n';

import { DEFAULT_SHARING, useSharing } from './sharing';
import { useSharingSummary } from './sharing-card';

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
const CIRCLE = '0190a8a0-0000-7000-8000-0000000000aa';
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '0190a8a0-0000-7000-8000-0000000000aa' }),
}));
jest.mock('@/features/storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('@/features/location/location-session', () => ({ updateSharing: jest.fn() }));
jest.mock('@/features/circles/queries', () => ({
  useCircles: () => ({ data: [] }),
  useCircle: () => undefined,
}));
jest.mock('@/features/auth/auth-store', () => ({
  onSignedIn: jest.fn(),
  onSignedOut: jest.fn(),
  useAuth: (select: (state: { userId: string }) => unknown) =>
    select({ userId: '0190f7a4-1111-7111-8111-000000000001' }),
}));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  useSharing.setState(DEFAULT_SHARING, true);
});

describe("a circle's settings on their own screens (the owner, 2026-10-21)", () => {
  it('sums up what the circle gets in one line for its row', async () => {
    const { result, rerender } = await renderHook(() => useSharingSummary(CIRCLE));
    expect(result.current).toBe('Tam konum · sen kapatana kadar');
    useSharing.setState({ ...DEFAULT_SHARING, ghost: 'freeze' }, true);
    await rerender({});
    expect(result.current).not.toContain('Tam konum');
  });

  it('opens the sharing and the places of the circle on screens of their own', async () => {
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <CircleSharingScreen />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('sharing-card')).toBeTruthy();
    await render(<CirclePlacesScreen />);
    expect(screen.getByTestId('add-place')).toBeTruthy();
  });
});

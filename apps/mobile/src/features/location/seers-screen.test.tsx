import type { Circle, MemberCard } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';

import SeersScreen from '@/app/(app)/seers';
import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
const mockPush = jest.fn<undefined, [unknown]>();
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: (route: unknown) => {
      mockPush(route);
    },
  },
}));
jest.mock('@/features/storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('@/features/location/location-session', () => ({
  forgetAllHistory: jest.fn(),
  resumeSharing: jest.fn(),
  stopSharing: jest.fn(),
}));
const ME = '0190a8a0-0000-7000-8000-0000000000f1';
jest.mock('@/features/auth/auth-store', () => ({
  onSignedIn: jest.fn(),
  onSignedOut: jest.fn(),
  useAuth: (select: (state: { userId: string }) => unknown) =>
    select({ userId: '0190a8a0-0000-7000-8000-0000000000f1' }),
}));
const member = (userId: string, name: string): MemberCard => ({
  userId,
  role: 'owner',
  status: 'active',
  username: name.toLowerCase(),
  displayName: name,
  avatar: null,
  device: null,
});
const FRIENDSHIP = '0190a8a0-0000-7000-8000-0000000000f9';
const mockCircles: Circle[] = [
  {
    id: FRIENDSHIP,
    kind: 'pair',
    name: null,
    epoch: 1,
    epochStartedAt: 0,
    myRole: 'owner',
    myStatus: 'active',
    members: [member(ME, 'Ben'), member('0190a8a0-0000-7000-8000-0000000000f2', 'Deniz')],
  },
];
jest.mock('@/features/circles/queries', () => ({ useCircles: () => ({ data: mockCircles }) }));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('who sees my location (UX düzeni 4)', () => {
  it("opens a circle's own sharing settings from its card", async () => {
    await render(<SeersScreen />);
    expect(screen.getAllByText('Deniz').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId(`seers-open-${FRIENDSHIP}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/circle/[id]', params: { id: FRIENDSHIP } });
  });
});

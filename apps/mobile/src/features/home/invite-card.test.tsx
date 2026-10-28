import type { Circle } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => {
      mockPush(route);
    },
  },
}));
const mockCircles: { current: Circle[] | undefined } = { current: [] };
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: mockCircles.current }) }));
const mockCreateInvite = jest.fn(() => Promise.resolve({ link: 'https://bargu.app/i#abc' }));
jest.mock('../circles/circles-api', () => ({
  circlesApi: { createInvite: () => mockCreateInvite() },
}));

import { useAuth } from '../auth/auth-store';
import { InviteCard } from './invite-card';

const ME = '0190f7a4-1111-7111-8111-000000000001';
const ADA = '0190f7a4-1111-7111-8111-000000000002';
const member = (userId: string, status: 'active' | 'invited') => ({
  userId,
  role: 'member' as const,
  status,
  username: null,
  displayName: 'Test',
  avatar: null,
  device: null,
});
const friendship = (status: 'active' | 'invited'): Circle => ({
  id: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  kind: 'pair',
  name: null,
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'owner',
  myStatus: 'active',
  members: [member(ME, 'active'), member(ADA, status)],
});

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ userId: ME });
});

describe('the empty map invites (the PM report T7, 2026-10-29)', () => {
  it('offers a link to send, or a QR code to show, while nobody is there', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    mockCircles.current = [friendship('invited')];
    await render(<InviteCard />);
    expect(screen.getByText('Haritan şimdilik boş')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('invite-share'));
    expect(mockCreateInvite).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]?.[0]).toMatchObject({ message: expect.any(String) as string });
    expect(JSON.stringify(share.mock.calls[0]?.[0])).toContain('https://bargu.app/i#abc');
    await fireEvent.press(screen.getByTestId('invite-qr'));
    expect(mockPush).toHaveBeenCalledWith('/add/qr');
    share.mockRestore();
  });

  it('is gone once someone is there, and waits for the circles to be known', async () => {
    mockCircles.current = [friendship('active')];
    const view = await render(<InviteCard />);
    expect(screen.queryByTestId('invite-card')).toBeNull();
    mockCircles.current = undefined;
    await view.rerender(<InviteCard />);
    expect(screen.queryByTestId('invite-card')).toBeNull();
  });
});

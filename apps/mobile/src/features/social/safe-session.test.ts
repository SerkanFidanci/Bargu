import type { SafePayload } from '@bargu/schemas';

import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import { circlesKey } from '../circles/circle-cache';
import { circleOf, memoryStore, nth, somebody } from '../location/test-support';
import { queryClient } from '../query-client';

const mockStore = memoryStore();
jest.mock('@/ui/toast', () => ({ toast: { info: jest.fn(), notice: jest.fn() } }));
jest.mock('@/theme/haptics', () => ({ feedback: jest.fn() }));
// What the session wires to the network, the keys and the location service: not what is tested.
jest.mock('../auth/api-client', () => ({
  ApiError: class ApiError extends Error {
    status = 0;
    code = '';
  },
}));
jest.mock('../auth/auth-store', () => ({
  api: { authed: jest.fn() },
  onSignedOut: jest.fn(),
  useAuth: { getState: () => ({ device: null }) },
}));
jest.mock('../live/live-session', () => ({ circleSync: { refresh: jest.fn() }, keys: jest.fn() }));
jest.mock('../location/tracker', () => ({ currentFix: jest.fn(), lastKnownFix: jest.fn() }));
jest.mock('expo-battery', () => ({ getPowerStateAsync: jest.fn() }));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => true, vault: () => mockStore }));

import { receivedSafe } from './safe-session';
import { resetSpot, useSafeSpot } from './safe-spot';

const ayse = somebody();
const bora = somebody();
const circle = circleOf([ayse, bora], { name: 'Aile' });
const info = toast.info as jest.Mock;
const notice = toast.notice as jest.Mock<void, [string, string, () => void]>;
const haptic = feedback as jest.Mock;

const message = (n: number): SafePayload => ({
  kind: 'safe',
  id: `${'A'.repeat(19)}${String(n).padStart(2, '0')}A`,
  lat: 41 + n / 100,
  lng: 29,
  acc: 8,
  bat: 45,
  ts: Date.now(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  resetSpot();
  queryClient.setQueryData(circlesKey, [circle]);
});

describe('"Güvendeyim" in the open app (docs/ADR/0029)', () => {
  it('shows a message as a line that shows its place on the map when tapped, with a haptic', () => {
    receivedSafe(circle.id, bora.userId, message(1));
    expect(haptic).toHaveBeenCalledWith('success');
    expect(notice).toHaveBeenCalledTimes(1);
    const [text, tone, onTap] = nth(notice.mock.calls);
    expect(text).toMatch(/^Test: (İyiyim|I'm safe)/);
    expect(tone).toBe('success');
    expect(useSafeSpot.getState().spot).toBeNull();
    onTap();
    expect(useSafeSpot.getState().spot).toMatchObject({ lng: 29, acc: 8, circleId: circle.id });
  });

  it('sums up past six an hour from one person in one plain line, once: no haptic, no more', () => {
    for (let n = 1; n <= 6; n += 1) receivedSafe(circle.id, bora.userId, message(n));
    expect(notice).toHaveBeenCalledTimes(6);
    expect(haptic).toHaveBeenCalledTimes(6);
    info.mockClear();
    haptic.mockClear();

    receivedSafe(circle.id, bora.userId, message(7));
    receivedSafe(circle.id, bora.userId, message(8));
    receivedSafe(circle.id, bora.userId, message(9));
    // One line, the plain kind of toast (only a `success` one vibrates), and no haptic of its own.
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(nth(info.mock.calls) as unknown[])).toMatch(/1 /);
    expect(haptic).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(6);
  });

  it('shows nothing for a repeat, or for a message from someone outside the circle', () => {
    receivedSafe(circle.id, bora.userId, message(1));
    receivedSafe(circle.id, bora.userId, message(1));
    receivedSafe(circle.id, '0190f7a4-0000-7000-8000-00000000dead', message(2));
    expect(notice).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });
});

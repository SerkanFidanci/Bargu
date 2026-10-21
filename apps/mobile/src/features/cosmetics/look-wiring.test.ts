import type { Plan } from '@bargu/schemas';

import i18n from '@/i18n';
import { useToasts } from '@/ui/toast';

const mockRefresh = jest.fn<Promise<void>, [boolean | undefined]>();
const mockChoose = jest.fn<Promise<void>, [{ ring: string | null; frame: string | null }]>();
jest.mock('./look-session', () => ({
  refreshPass: (force?: boolean) => mockRefresh(force),
  chooseLook: (choice: { ring: string | null; frame: string | null }) => mockChoose(choice),
  publishLook: () => Promise.resolve(),
  resetLooks: jest.fn(),
  restoreLooks: jest.fn(),
  useMyLook: { getState: () => ({ choice: { ring: null, frame: null } }) },
}));
// The pieces of the app this wiring listens to; here only the plan in the query cache matters.
jest.mock('../auth/auth-store', () => {
  const listeners: (() => void)[] = [];
  return {
    onSignedOut: (listener: () => void) => listeners.push(listener),
    signOutForTest: () => {
      for (const listener of listeners) listener();
    },
  };
});
jest.mock('../billing/plan', () => ({ planKey: ['plan'] }));
jest.mock('../circles/circle-cache', () => ({ circlesKey: ['circles'] }));
jest.mock('../circles/circle-sync', () => ({ useCircleKeys: { subscribe: jest.fn() } }));
jest.mock('../live/live-session', () => ({ onOnline: jest.fn(), onServerEvents: jest.fn() }));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('../query-client', () => {
  const { QueryClient } =
    jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { queryClient: new QueryClient() };
});

import { queryClient } from '../query-client';
import './look-wiring';
import { tryStyle, useTrying } from './look-trying';

const { signOutForTest } = jest.requireMock<{ signOutForTest: () => void }>('../auth/auth-store');

const plan = (cosmetics: string[], pendingCosmetics: string[]): Plan => ({
  plan: 'free',
  product: null,
  source: null,
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics,
  testBilling: true,
  pendingCosmetics,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
afterAll(() => {
  queryClient.clear();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockImplementation(() => Promise.resolve());
  mockChoose.mockImplementation(() => Promise.resolve());
  useToasts.setState({ current: null });
  // The account signs out between the tests: the next plan is compared with nothing.
  signOutForTest();
  queryClient.clear();
});

describe('the plan in the cache opens a pack a parent said yes to (docs/ADR/0025, slice 3c)', () => {
  it('chooses the style tried and says so when the plan that waited now has the pack', async () => {
    queryClient.setQueryData(['plan'], plan([], ['frames']));
    tryStyle('frame', 'holo');
    // plan.changed made the app fetch the plan again: the yes.
    queryClient.setQueryData(['plan'], plan(['frames'], []));
    await settle();
    expect(useToasts.getState().current?.message).toBe('Ebeveynin onayladı: Pin çerçeveleri');
    expect(mockChoose).toHaveBeenCalledWith({ ring: null, frame: 'holo' });
    expect(useTrying.getState().frame).toBeUndefined();
  });

  it('does nothing when the pack was bought at once, or the parent said no', async () => {
    queryClient.setQueryData(['plan'], plan([], []));
    tryStyle('ring', 'dots');
    queryClient.setQueryData(['plan'], plan(['rings'], []));
    await settle();
    expect(mockChoose).not.toHaveBeenCalled();
    expect(useToasts.getState().current).toBeNull();

    queryClient.setQueryData(['plan'], plan(['rings'], ['frames']));
    queryClient.setQueryData(['plan'], plan(['rings'], []));
    await settle();
    expect(mockChoose).not.toHaveBeenCalled();
    expect(useToasts.getState().current).toBeNull();
  });

  it('forgets what waited when the account signs out, and what was tried with it', async () => {
    queryClient.setQueryData(['plan'], plan([], ['rings']));
    tryStyle('ring', 'dots');
    signOutForTest();
    expect(useTrying.getState().ring).toBeUndefined();
    queryClient.setQueryData(['plan'], plan(['rings'], []));
    await settle();
    expect(mockChoose).not.toHaveBeenCalled();
    expect(useToasts.getState().current).toBeNull();
  });
});

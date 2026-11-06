import { probe } from '../../location/probe';
import { startAccountRecorder, stopAccountRecorder } from './account-recorder';
import { scenarioMetricsSnapshot } from './scenario';
import { forgetBackgroundLive, recorder, useMeasures, useStalls } from './store';

let mockAuth = {
  status: 'loading' as 'loading' | 'signedOut' | 'signedIn',
  userId: null as string | null,
  device: null as { deviceId: string } | null,
};
let mockReconcile: (() => void) | undefined;
let mockSignedOut: (() => void) | undefined;

jest.mock('../../auth/auth-store', () => ({
  useAuth: {
    getState: () => mockAuth,
    subscribe: (listener: () => void) => {
      mockReconcile = listener;
      return jest.fn();
    },
  },
  onSignedOut: (listener: () => void) => {
    mockSignedOut = listener;
    return jest.fn();
  },
}));
jest.mock('../../storage/vault', () => ({ isVaultOpen: () => false, vault: jest.fn() }));
jest.mock('../slots', () => ({ useDevSlots: { setState: jest.fn() } }));
jest.mock('./overlay', () => ({ MeasureOverlay: () => null }));
jest.mock('./watch', () => ({ startStallWatch: jest.fn() }));

beforeAll(() => {
  jest.requireActual('./index');
});

beforeEach(() => {
  stopAccountRecorder();
  forgetBackgroundLive();
  useStalls.setState({ list: [], spans: [], watching: false });
  mockAuth = { status: 'loading', userId: null, device: null };
});

afterEach(() => {
  stopAccountRecorder();
  forgetBackgroundLive();
  probe.current = null;
});

describe('measurement auth wiring', () => {
  it('retires A on signed-out and starts a fresh generation when B becomes signed in', () => {
    mockAuth = { status: 'signedIn', userId: 'user-a', device: { deviceId: 'device-a' } };
    mockReconcile?.();
    const listenerA = probe.current;
    listenerA?.count?.('engine.published.read');
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(1);

    mockAuth = { status: 'signedOut', userId: null, device: null };
    mockReconcile?.();
    expect(probe.current).toBeNull();
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(0);

    listenerA?.count?.('engine.published.read');
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(0);

    mockAuth = { status: 'signedIn', userId: 'user-b', device: { deviceId: 'device-b' } };
    mockReconcile?.();
    expect(probe.current).not.toBe(listenerA);
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(0);
    probe.current?.count?.('engine.published.read');
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(1);
  });

  it('keeps the independent backgroundLive sign-out reset registered', () => {
    recorder.backgroundLive({ kind: 'notice' });
    expect(useMeasures.getState().backgroundLive.notices).toBe(1);

    mockSignedOut?.();

    expect(useMeasures.getState().backgroundLive.notices).toBe(0);
  });

  it('does not replace an existing same-account listener on duplicate auth state', () => {
    const existing = startAccountRecorder('user-a:device-a');
    existing.listener.count?.('engine.published.read');
    mockAuth = { status: 'signedIn', userId: 'user-a', device: { deviceId: 'device-a' } };

    mockReconcile?.();

    expect(probe.current).toBe(existing.listener);
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(1);
  });
});

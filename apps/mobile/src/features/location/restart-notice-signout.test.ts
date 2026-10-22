import './location-session';
import { startTracking } from './tracker';

// Sign-out, account deletion and a session the server ended all come through the sign-out
// listeners (auth-store.ts endLocally): the location session stops the service there, and with it
// the restart notice. This runs the real listeners.
jest.mock('../auth/auth-store', () => {
  const listeners: (() => void)[] = [];
  return {
    api: { authed: () => Promise.reject(new Error('offline')) },
    useAuth: { getState: () => ({ userId: null, device: null }) },
    onSignedOut: (listener: () => void) => listeners.push(listener),
    signedOutListeners: listeners,
  };
});
// The live connection is not what is tested: every listener it takes is accepted and never called.
jest.mock('../live/live-session', () => {
  const listen = () => () => undefined;
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    keys: () => null,
    liveRequest: () => null,
    circleSync: { refresh: () => Promise.resolve(), ensure: () => Promise.resolve() },
    useConnection: create(() => ({ online: false, drops: 0 })),
    onServerEvents: listen,
    onLiveMessage: listen,
    onOnline: listen,
    onFirstLoad: listen,
    onCirclesGone: listen,
    onPeopleDeparted: listen,
  };
});
jest.mock('../storage/vault', () => {
  const { memoryStore } = jest.requireActual<typeof import('./test-support')>('./test-support');
  const store = memoryStore();
  return { isVaultOpen: () => true, vault: () => store };
});
jest.mock('../notifications/extension-share', () => ({
  shareMutesWithExtension: () => Promise.resolve(),
  clearExtensionShare: () => Promise.resolve(),
}));
// Native modules that only exist on a phone (the test does not use them; the app imports them).
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-battery', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));

const mockArm = jest.fn<undefined, [string, string]>();
const mockDisarm = jest.fn<undefined, []>();
jest.mock('../../../modules/bargu-restart-notice', () => ({
  __esModule: true,
  default: {
    arm: (...args: [string, string]) => {
      mockArm(...args);
    },
    disarm: () => {
      mockDisarm();
    },
  },
}));
let mockRunning = false;
jest.mock('expo-location', () => ({
  Accuracy: { High: 5, Balanced: 3 },
  ActivityType: { Other: 1 },
  hasStartedLocationUpdatesAsync: () => Promise.resolve(mockRunning),
  startLocationUpdatesAsync: () => {
    mockRunning = true;
    return Promise.resolve();
  },
  stopLocationUpdatesAsync: () => {
    mockRunning = false;
    return Promise.resolve();
  },
}));

describe('signing out', () => {
  it('clears the restart notice: nobody is shared with, nothing to say after a restart', async () => {
    await startTracking({
      gps: true,
      title: 'Konumun paylaşılıyor',
      body: 'Çemberlerin seni haritada görüyor.',
      restart: { title: 'Paylaşım durdu', body: 'Bargu’yu aç.' },
    });
    expect(mockArm).toHaveBeenCalledTimes(1);
    expect(mockDisarm).not.toHaveBeenCalled();

    // Every listener the app registered for the end of a session, as endLocally runs them.
    const { signedOutListeners } = jest.requireMock<{ signedOutListeners: (() => void)[] }>(
      '../auth/auth-store',
    );
    expect(signedOutListeners.length).toBeGreaterThan(0);
    for (const listener of signedOutListeners) listener();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockDisarm).toHaveBeenCalledTimes(1);
    expect(mockRunning).toBe(false);
  });
});

import { forgetAllHistory } from './location-session';
import { memoryStore } from './test-support';

// The phone the module singletons act as: its vault is a plain map here.
const mockVault = memoryStore();
jest.mock('../auth/auth-store', () => ({
  api: { authed: () => Promise.reject(new Error('offline')) },
  useAuth: { getState: () => ({ userId: null, device: null }) },
  onSignedOut: jest.fn(),
}));
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
jest.mock('../storage/vault', () => ({ isVaultOpen: () => true, vault: () => mockVault }));
jest.mock('../notifications/extension-share', () => ({
  shareMutesWithExtension: () => Promise.resolve(),
}));
// Native modules that only exist on a phone (the test does not use them; the app imports them).
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-battery', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));

describe('consent withdrawn ("Geçmişimi de sil")', () => {
  it("wipes the phone's own trail, offline too, and nothing else of the vault", async () => {
    mockVault.set('history:mine:1791880200000', '[]');
    mockVault.set('history:mine:1791881100000', '[]');
    mockVault.set('loc:published:v1', '[]');
    expect(await forgetAllHistory()).toBe('later');
    expect(mockVault.keys().filter((key) => key.startsWith('history:mine:'))).toEqual([]);
    expect(mockVault.get('loc:published:v1')).toBe('[]');
  });
});

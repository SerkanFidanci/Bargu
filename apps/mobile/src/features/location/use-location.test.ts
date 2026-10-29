import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import i18n from '@/i18n';

import { useMapOpen } from './map-open';
import { useSharing } from './sharing';
import { useLocationSession } from './use-location';

const mockStartTracking = jest.fn<Promise<void>, [unknown]>(() => Promise.resolve());
const mockStopTracking = jest.fn<Promise<void>, []>(() => Promise.resolve());
/** Whether any circle gets the location now (false: ghost, stopped, nothing shared, time up). */
let mockActive = true;
const mockStop = jest.fn();
const mockWatchLive = jest.fn<Promise<() => void>, [(fix: unknown) => void]>(() =>
  Promise.resolve(mockStop),
);
const mockFix = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());

jest.mock('./tracker', () => ({
  checkLocationPermission: () => Promise.resolve(),
  lastKnownFix: () => Promise.resolve(null),
  startTracking: (options: unknown) => mockStartTracking(options),
  stopTracking: () => mockStopTracking(),
  useLocationPermission: (select: (state: { state: string }) => unknown) =>
    select({ state: 'granted' }),
  watchLive: (onFix: (fix: unknown) => void) => mockWatchLive(onFix),
}));
// Why a location is old ("Neden eski?") has its own tests (state-report.test.ts, why.test.ts).
jest.mock('./state-signals', () => ({
  watchWhy: () => undefined,
  refreshWhy: () => Promise.resolve(),
}));
jest.mock('./location-session', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    locationEngine: {
      active: () => mockActive,
      gps: () => true,
      changed: () => Promise.resolve(),
      fix: (...args: unknown[]) => mockFix(...args),
    },
    restoreLocations: () => undefined,
    useLiveUntil: create(() => ({ until: 0 })),
  };
});
// expo-router's native stack needs a native view jest does not have on Linux (CI); only its focus
// effect is imported here, for the watch requests this test does not cover.
jest.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: [] }) }));
// Who the user is, for a friend's name when a timed share ends (its own tests: person-share.test).
jest.mock('../auth/auth-store', () => ({
  useAuth: (select: (state: { userId: string | null }) => unknown) => select({ userId: null }),
}));
jest.mock('../live/live-session', () => ({
  liveRequest: () => null,
  useConnection: (select: (state: { online: boolean }) => unknown) => select({ online: true }),
}));

let appState: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appState = handler;
    return { remove: () => undefined };
  });
  useMapOpen.setState({ open: false });
  mockActive = true;
});

/** Lets the watch's promise settle. */
const settle = () => act(() => Promise.resolve());

describe('the location service and its restart notice (docs/ADR/0028 addendum)', () => {
  const started = () => mockStartTracking.mock.calls.map(([options]) => options);

  it('starts the service with the restart notice in the current language, and rewrites it when the language changes', async () => {
    await act(() => i18n.changeLanguage('tr'));
    await renderHook(() => {
      useLocationSession(true);
    });
    await settle();
    expect(started()).toHaveLength(1);
    expect(started()[0]).toMatchObject({
      restart: { title: 'Paylaşım durdu', body: i18n.t('location.service.stoppedBody') },
    });
    expect(i18n.t('location.service.stoppedBody')).toContain('Bargu');

    await act(() => i18n.changeLanguage('en'));
    await settle();
    expect(started().at(-1)).toMatchObject({
      restart: { title: 'Sharing stopped', body: i18n.t('location.service.stoppedBody') },
    });
    await act(() => i18n.changeLanguage('tr'));
  });

  it('stops the service, and with it the notice, when nothing is shared any more (ghost, stop all)', async () => {
    await renderHook(() => {
      useLocationSession(true);
    });
    await settle();
    expect(mockStartTracking).toHaveBeenCalledTimes(1);
    expect(mockStopTracking).not.toHaveBeenCalled();
    // Ghost mode (or "Tümünü durdur", or the last timed share ending): no circle gets the location.
    mockActive = false;
    await act(() => {
      useSharing.setState({ ghost: 'hide' });
    });
    await settle();
    expect(mockStopTracking).toHaveBeenCalled();
    expect(mockStartTracking).toHaveBeenCalledTimes(1);
    await act(() => {
      useSharing.setState({ ghost: 'off' });
    });
  });
});

describe("this phone's own pin every second (docs/ADR/0028 §5)", () => {
  it('follows the GPS while the map is on screen, as the live source', async () => {
    useMapOpen.setState({ open: true });
    await renderHook(() => {
      useLocationSession(true);
    });
    await settle();
    expect(mockWatchLive).toHaveBeenCalledTimes(1);
    mockWatchLive.mock.calls[0]?.[0]({ lat: 1, lng: 2, acc: 5, spd: null, hdg: null, ts: 1 });
    expect(mockFix).toHaveBeenCalledWith(expect.anything(), 'live');
  });

  it('stops at once when the map closes', async () => {
    useMapOpen.setState({ open: true });
    await renderHook(() => {
      useLocationSession(true);
    });
    await settle();
    await act(() => {
      useMapOpen.setState({ open: false });
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('stops at once when the app goes to the background (the screen turns off)', async () => {
    useMapOpen.setState({ open: true });
    await renderHook(() => {
      useLocationSession(true);
    });
    await settle();
    await act(() => {
      appState?.('background');
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('is off while the map is not seen and nobody watches', async () => {
    await renderHook(() => {
      useLocationSession(true);
    });
    await settle();
    expect(mockWatchLive).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useMapOpen } from './map-open';
import { useLocationSession } from './use-location';

const mockStop = jest.fn();
const mockWatchLive = jest.fn<Promise<() => void>, [(fix: unknown) => void]>(() =>
  Promise.resolve(mockStop),
);
const mockFix = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());

jest.mock('./tracker', () => ({
  checkLocationPermission: () => Promise.resolve(),
  lastKnownFix: () => Promise.resolve(null),
  startTracking: () => Promise.resolve(),
  stopTracking: () => Promise.resolve(),
  useLocationPermission: (select: (state: { state: string }) => unknown) =>
    select({ state: 'granted' }),
  watchLive: (onFix: (fix: unknown) => void) => mockWatchLive(onFix),
}));
jest.mock('./location-session', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    locationEngine: {
      active: () => true,
      gps: () => true,
      changed: () => Promise.resolve(),
      fix: (...args: unknown[]) => mockFix(...args),
    },
    restoreLocations: () => undefined,
    useLiveUntil: create(() => ({ until: 0 })),
  };
});
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: [] }) }));
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
});

/** Lets the watch's promise settle. */
const settle = () => act(() => Promise.resolve());

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

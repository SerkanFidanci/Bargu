import type { Me, WeatherSnapshot } from '@bargu/schemas';
import { act, render } from '@testing-library/react-native';
import { Profiler, type ReactNode, type Ref } from 'react';

import HomeScreen from '@/app/(app)/index';
import '@/i18n';
import { useMyFix } from '@/features/location/engine';
import type { Fix } from '@/features/location/send';
import { GALATA, moved } from '@/features/location/test-support';
import {
  type SafeSpot,
  resetSpot,
  showSpot,
  spotBounds,
  useSafeSpot,
} from '@/features/social/safe-spot';
import { useWeather } from '@/features/weather/weather';

/**
 * The home screen itself, drawn as the phone draws it, with the heavy parts under it (the map, the
 * sheets, the layers, the cards) replaced by nothing: what is counted is how often the SCREEN is
 * drawn again, which is what made the owner's phone lag (QA 27 B-2). With the map open the phone's
 * own position arrives every second (use-location.ts); the screen follows only what it needs of it
 * (location/my-position.ts), so a minute of positions draws it once, not sixty times. The hook
 * tests (my-position.test.tsx) cannot see this screen go back to listening to every position;
 * this one can.
 */

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: () => undefined,
}));
jest.mock('@/features/auth/auth-store', () => ({
  api: { authed: jest.fn() },
  onSignedOut: jest.fn(),
  useAuth: (select: (state: { userId: string }) => unknown) =>
    select({ userId: '0190f7a4-1111-7111-8111-000000000001' }),
}));
jest.mock('@/features/live/live-session', () => ({
  onLiveMessage: jest.fn(),
  onOnline: jest.fn(),
}));
jest.mock('@/features/profile/queries', () => ({
  useMe: () => ({ data: mockMe }),
}));
jest.mock('@/features/circles/queries', () => ({ useCircles: () => ({ data: [] }) }));

// What the screen draws under it: not what is tested here.
jest.mock('@/features/home/dock', () => ({ Dock: () => null }));
jest.mock('@/features/home/map-shortcuts', () => ({ MapShortcuts: () => null }));
jest.mock('@/features/home/meeting-chip', () => ({ MeetingChip: () => null }));
jest.mock('@/features/home/seers-pill', () => ({
  ...jest.requireActual<typeof import('@/features/home/seers-pill')>('@/features/home/seers-pill'),
  SeersPill: () => null,
}));
jest.mock('@/features/home/sheets', () => ({ MeSheet: () => null }));
jest.mock('@/features/circles/add-sheet', () => ({ AddSheet: () => null }));
jest.mock('@/features/circles/circles-sheet', () => ({ CirclesSheet: () => null }));
jest.mock('@/features/social/status-sheet', () => ({ StatusSheet: () => null }));
jest.mock('@/features/social/safe-sheet', () => ({ SafeSheet: () => null }));
jest.mock('@/features/home/safe-button', () => ({ SafeButton: () => null }));
jest.mock('@/features/social/safe-spot-layer', () => ({ SafeSpotLayer: () => null }));
jest.mock('@/features/location/location-banner', () => ({ LocationBanner: () => null }));
jest.mock('@/features/location/new-phone-card', () => ({ NewPhoneCard: () => null }));
jest.mock('@/features/location/sharing-reminder-card', () => ({
  SharingReminderCard: () => null,
}));
jest.mock('@/features/notifications/notification-card', () => ({ NotificationCard: () => null }));
jest.mock('@/features/location/use-location', () => ({ useWatchCircles: () => undefined }));
jest.mock('@/features/dev/swarm-panel', () => ({ SwarmLayer: () => null, SwarmPanel: () => null }));
jest.mock('@/features/map/people-layer', () => ({ PeopleLayer: () => null }));
jest.mock('@/features/places/places-layer', () => ({ PlacesLayer: () => null }));
jest.mock('@/features/plan/meeting-points-layer', () => ({ MeetingPointsLayer: () => null }));
jest.mock('@/features/weather/weather-layer', () => ({ WeatherLayer: () => null }));
jest.mock('@/features/map/map-credit', () => ({ MapCredit: () => null }));
jest.mock('@/features/map/people-ui', () => ({
  usePeopleUi: () => ({
    onMapPress: () => undefined,
    handlersFor: () => ({}),
    openGroup: () => undefined,
    overlay: null,
  }),
}));
jest.mock('@/ui/confetti', () => ({
  Confetti: () => null,
  useCelebration: (select: (state: { pending: boolean; done: () => void }) => unknown) =>
    select({ pending: false, done: () => undefined }),
}));
// The map: draws its children, and hands the test what it was given (`mockMap.onSettle` is the
// map reporting where the camera stopped).
const mockMap: {
  onSettle: ((view: { center: [number, number]; zoom: number }) => void) | null;
  onPress: (() => void) | null;
} = {
  onSettle: null,
  onPress: null,
};
// What the screen asks of the camera (a tapped "Güvendeyim" shows its place).
const mockFitTo = jest.fn();
jest.mock('@/features/map/bargu-map', () => {
  const { useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  return {
    BarguMap: (props: {
      children?: ReactNode;
      onSettle?: (view: { center: [number, number]; zoom: number }) => void;
      onPress?: () => void;
      ref?: Ref<unknown>;
    }) => {
      mockMap.onSettle = props.onSettle ?? null;
      mockMap.onPress = props.onPress ?? null;
      useImperativeHandle(
        props.ref,
        () => ({
          fitTo: mockFitTo,
          focusOn: () => undefined,
          placeName: () => Promise.resolve(null),
          townName: () => Promise.resolve(null),
        }),
        [],
      );
      return props.children ?? null;
    },
  };
});

const mockMe: Me = {
  userId: '0190f7a4-1111-7111-8111-000000000001',
  username: 'seko',
  displayName: 'Seko',
  avatar: null,
  device: { id: '0190f7a4-1111-7111-8111-000000000002', platform: 'android', attested: true },
  passkeys: 0,
};

/** A grid of 2 × 2 cells round Istanbul, so the screen has a weather here to follow too. */
const snapshot: WeatherSnapshot = {
  at: 1,
  grid: { south: 40.5, west: 28.5, step: 0.5, rows: 2, cols: 2 },
  cells: [
    [0, 1, 18, 10, 0, 5],
    [0, 1, 17, 10, 0, 5],
    [3, 1, 15, 90, 0, 9],
    [3, 1, 14, 90, 0, 9],
  ],
};

/** Every time the screen (or anything it draws, which is nothing but the screen here) committed. */
let commits = 0;
const countCommit = () => {
  commits += 1;
};

async function drawHome(): Promise<void> {
  await render(
    <Profiler id="home" onRender={countCommit}>
      <HomeScreen />
    </Profiler>,
  );
  // The shared clock and the map's own effects settle; what follows is counted from here.
  await act(() => Promise.resolve());
}

/** The map reports where its camera stopped: on the phone, so "away from me" is worked out too. */
async function mapSettlesAtPhone(): Promise<void> {
  const settle = mockMap.onSettle;
  if (settle === null) throw new Error('the screen gave the map no onSettle');
  await act(() => {
    settle({ center: [GALATA.lng, GALATA.lat], zoom: 15 });
  });
}

/** One position a second, for a minute: the phone with the map open, walking a little. */
async function aMinuteOfPositions(from: Fix = GALATA): Promise<void> {
  for (let second = 0; second < 60; second += 1) {
    await act(() => {
      useMyFix.setState({ fix: moved(from, second * 0.8, second * 1_000) });
    });
  }
}

beforeEach(() => {
  commits = 0;
  mockMap.onSettle = null;
  mockMap.onPress = null;
  mockFitTo.mockClear();
  resetSpot();
  useMyFix.setState({ fix: null, since: null });
  useWeather.setState({ snapshot });
});

describe('the home screen and the phone’s own position every second (QA 27 B-2)', () => {
  it('is drawn once for a minute of positions, from the first one on, not sixty times', async () => {
    await drawHome();
    await mapSettlesAtPhone();
    const before = commits;
    expect(before).toBeGreaterThan(0);

    await aMinuteOfPositions();
    // The first position changes what the screen shows (the map looks there, the square, the weather
    // here): one drawing. The other fifty-nine change none of it.
    expect(commits - before).toBe(1);
  });

  it('is not drawn again at all by a minute of positions once it has one', async () => {
    await act(() => {
      useMyFix.setState({ fix: GALATA });
    });
    await drawHome();
    await mapSettlesAtPhone();
    const before = commits;

    await aMinuteOfPositions();
    expect(commits - before).toBe(0);
  });

  it('is drawn again when what it follows really changes: the phone leaves its square', async () => {
    await act(() => {
      useMyFix.setState({ fix: GALATA });
    });
    await drawHome();
    await mapSettlesAtPhone();
    await aMinuteOfPositions();
    const before = commits;

    // About 17 km east: another square, the map is far from the phone, another weather cell.
    const there: Fix = { ...GALATA, lng: GALATA.lng + 0.2, ts: 61_000 };
    await act(() => {
      useMyFix.setState({ fix: there });
    });
    expect(commits - before).toBeGreaterThanOrEqual(1);
    // ... and a minute more there (one position at a time) draws nothing again.
    const after = commits;
    await aMinuteOfPositions(there);
    expect(commits - after).toBe(0);
  });
});

describe('a tapped "Güvendeyim" and the map (docs/ADR/0029 §5)', () => {
  const spot: SafeSpot = {
    id: 'AAAAAAAAAAAAAAAAAAAAAA',
    circleId: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
    name: 'Ayşe',
    lat: 41.0256,
    lng: 28.9742,
    acc: 708,
    bat: 45,
    ts: Date.now(),
  };

  it('looks at the place when one is asked for: its circle whole, and again for each ask', async () => {
    await drawHome();
    expect(mockFitTo).not.toHaveBeenCalled();
    await act(() => {
      showSpot(spot);
    });
    expect(mockFitTo).toHaveBeenCalledTimes(1);
    expect(mockFitTo).toHaveBeenLastCalledWith(spotBounds(spot), 0);
    await act(() => {
      showSpot(spot);
    });
    expect(mockFitTo).toHaveBeenCalledTimes(2);
  });

  it('looks at it at once when the tap opened the app (the place was asked for before the map)', async () => {
    showSpot(spot);
    await drawHome();
    expect(mockFitTo).toHaveBeenCalledWith(spotBounds(spot), 0);
  });

  it('takes the place away with a tap on the map, and does not look at it again for that', async () => {
    await drawHome();
    await act(() => {
      showSpot(spot);
    });
    mockFitTo.mockClear();
    await act(() => {
      mockMap.onPress?.();
    });
    expect(useSafeSpot.getState().spot).toBeNull();
    expect(mockFitTo).not.toHaveBeenCalled();
  });
});

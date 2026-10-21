import type { Circle } from '@bargu/schemas';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

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
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// The camera itself is not what is measured: the scanner's sweeping line is.
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { CameraView: View, useCameraPermissions: () => [{ granted: true }, jest.fn()] };
});
jest.mock('@/features/storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('@/features/location/location-session', () => ({
  meetings: { eta: () => undefined },
  sayArrived: () => Promise.resolve(),
  updateSharing: (change: never) => {
    mockUpdateSharing(change);
  },
}));
const mockUpdateSharing = jest.fn<undefined, [(current: SharingSettings) => SharingSettings]>(
  (change) => {
    useSharing.setState(change(useSharing.getState()), true);
  },
);

import { MapShortcuts } from '@/features/home/map-shortcuts';
import { MeetingChip } from '@/features/home/meeting-chip';
import { DEFAULT_SHARING, type SharingSettings, useSharing } from '@/features/location/sharing';
import { Footprints } from '@/features/map/footprints';
import type { Place } from '@/features/places/place-model';
import { usePlayClock } from '@/features/weather/play-clock';
import i18n from '@/i18n';
import { EffectsPaused, useEffectChoice } from '@/theme/effects';
import { weatherFx } from '@/theme';
import { AvatarMarker, type MarkerActivity } from '@/ui/avatar-marker';
import { QrCode } from '@/ui/qr-code';
import { QrScanner } from '@/ui/qr-scanner';

/**
 * The measurement the PM asked for (docs/ADR/0027): frames the map asks for while nobody touches
 * it, counted as requestAnimationFrame calls once what was started has had time to finish (the
 * longest one-off effect, the ghost's floats, takes under 7 s). An endless animation asks for a
 * frame every frame; a finished one asks for none.
 */
async function framesWhileIdle(settleMs = 10_000, windowMs = 3_000): Promise<number> {
  await act(() => {
    jest.advanceTimersByTime(settleMs);
  });
  const frames = jest.spyOn(globalThis, 'requestAnimationFrame');
  await act(() => {
    jest.advanceTimersByTime(windowMs);
  });
  const count = frames.mock.calls.length;
  frames.mockRestore();
  return count;
}

const MIN = 60_000;
const ME = '0190f7a4-1111-7111-8111-000000000001';
const family: Circle = {
  id: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  kind: 'family',
  name: 'Aile',
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [],
};
const home: Place = {
  id: '0190f7a4-2222-7222-8222-000000000001',
  circleId: family.id,
  version: 1,
  name: 'Ev',
  emoji: '🏠',
  lat: 41.03,
  lng: 28.95,
  radius: 100,
  ts: 1,
};
const meetAt = Date.UTC(2026, 9, 18, 14, 30);
const ACTIVITIES: MarkerActivity[] = [
  'still',
  'settled',
  'walking',
  'running',
  'cycling',
  'driving',
  'racing',
  'train',
  'plane',
];
const people = (news: number): ReactElement => (
  <>
    {ACTIVITIES.map((activity) => (
      <AvatarMarker key={activity} name={activity} avatar={null} activity={activity} news={news} />
    ))}
    <AvatarMarker name="low" avatar={null} lowBattery news={news} />
    <Footprints gait="walk" heading={0} center={30} color="#000" news={news} />
  </>
);

// Reanimated runs its frames on these timers: installed once, as the animations start on them.
jest.useFakeTimers();
// Seconds of animation frames are played through here: slower on a busy CI machine.
jest.setTimeout(30_000);

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  useSharing.setState(DEFAULT_SHARING, true);
});
afterEach(() => {
  useEffectChoice.setState({ level: 'full' });
});

describe('frames on the map while nobody touches it (docs/ADR/0027)', () => {
  it.each(['reduced', 'off'] as const)(
    'none from people at "%s", a new location or not',
    async (level) => {
      useEffectChoice.setState({ level });
      const view = await render(people(1));
      expect(await framesWhileIdle()).toBe(0);
      // A new location: at "reduced" one short motion, then still again.
      await view.rerender(people(2));
      expect(await framesWhileIdle()).toBe(0);
    },
  );

  it('frames from people at "full": the map stays lively, as the owner wished', async () => {
    // One walking person is enough to show it (every frame of a second asks for the next).
    await render(<AvatarMarker name="walking" avatar={null} activity="walking" news={1} />);
    expect(await framesWhileIdle(1_000, 1_000)).toBeGreaterThan(0);
  });

  it('none from people at "full" while the map is not on screen', async () => {
    await render(<EffectsPaused.Provider value>{people(1)}</EffectsPaused.Provider>);
    expect(await framesWhileIdle()).toBe(0);
  });

  it.each(['full', 'reduced', 'off'] as const)(
    'none from the shortcuts at "%s" once their effects are done',
    async (level) => {
      useEffectChoice.setState({ level });
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      await render(
        <MapShortcuts
          circles={[family]}
          away
          onRecenter={jest.fn()}
          meeting={{ circle: family, meetAt, place: home }}
          me={ME}
          now={meetAt}
          bottom={0}
          shared
        />,
      );
      // Every effect started: the radar, the ghost floating, "Geldim" ringing.
      await fireEvent.press(screen.getByTestId('shortcut-recenter'));
      await fireEvent.press(screen.getByTestId('shortcut-ghost'));
      expect(await framesWhileIdle()).toBe(0);
      alert.mockRestore();
    },
  );

  it.each(['full', 'reduced', 'off'] as const)(
    'none from the meeting chip at "%s" in its last minutes, its minute changing',
    async (level) => {
      useEffectChoice.setState({ level });
      const chip = (now: number) => (
        <MeetingChip
          circles={[family]}
          points={[{ circleId: family.id, title: 'Aile', place: home, meetAt, state: 'set' }]}
          now={now}
          me={ME}
        />
      );
      const view = await render(chip(meetAt - 5 * MIN));
      expect(await framesWhileIdle()).toBe(0);
      await view.rerender(chip(meetAt - 4 * MIN));
      expect(await framesWhileIdle()).toBe(0);
    },
  );

  it('frames from the weather only while it plays at "full" (20 s), then none', async () => {
    const { rerender } = await renderHook(
      ({ play }: { play: string }) => usePlayClock('full', play),
      { initialProps: { play: 'rain:1' } },
    );
    // Playing: frames.
    expect(await framesWhileIdle(weatherFx.play.ms / 2)).toBeGreaterThan(0);
    // Past its 20 seconds: the last frame holds, none more.
    expect(await framesWhileIdle(weatherFx.play.ms)).toBe(0);
    // Woken (a touch, a move): it plays again, then stops again.
    await rerender({ play: 'rain:2' });
    expect(await framesWhileIdle(weatherFx.play.ms + 1_000)).toBe(0);
  });

  it.each(['reduced', 'off'] as const)(
    'none from the weather at "%s": a still frame',
    async (level) => {
      await renderHook(() => usePlayClock(level, 'rain:1'));
      expect(await framesWhileIdle(0)).toBe(0);
    },
  );

  it('none from the QR screens once sade mod leaves "full" while they are open (QA 23)', async () => {
    await render(
      <>
        <QrCode value="bargu://invite/abc" size={200} label="Davet" />
        <QrScanner onScan={jest.fn()} size={200} />
      </>,
    );
    // At "full" the halo and the sweeping line run…
    expect(await framesWhileIdle(1_000, 1_000)).toBeGreaterThan(0);
    // …and stop at once when the user picks "less", no new visit needed.
    await act(() => {
      useEffectChoice.setState({ level: 'reduced' });
    });
    expect(await framesWhileIdle(1_000)).toBe(0);
  });
});

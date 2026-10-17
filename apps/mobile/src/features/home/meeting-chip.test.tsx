import type { Circle, LocPayload } from '@bargu/schemas';
import { act, render, screen } from '@testing-library/react-native';

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
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// What this phone celebrated is kept in its vault (MMKV, a native module): in memory here.
const mockVault = new Map<string, string>();
jest.mock('@/features/storage/vault', () => ({
  isVaultOpen: () => true,
  vault: () => ({
    get: (key: string) => mockVault.get(key),
    set: (key: string, value: string) => {
      mockVault.set(key, value);
    },
  }),
}));
// This phone's own estimate is not what the chip is about.
jest.mock('@/features/location/location-session', () => ({ meetings: { eta: () => undefined } }));

import { MeetingChip } from '@/features/home/meeting-chip';
import { useMyFix } from '@/features/location/engine';
import { useLocations } from '@/features/location/receive';
import type { Place } from '@/features/places/place-model';
import { useArrived, useLates } from '@/features/plan/meeting';
import type { MeetingPoint } from '@/features/plan/meeting-points';
import { useCelebration } from '@/ui/confetti';

const MIN = 60_000;
const ids = {
  me: '0190f7a4-1111-7111-8111-000000000001',
  bora: '0190f7a4-1111-7111-8111-000000000002',
  can: '0190f7a4-1111-7111-8111-000000000003',
  dana: '0190f7a4-1111-7111-8111-000000000004',
};
const member = (userId: string) => ({
  userId,
  role: 'member' as const,
  status: 'active' as const,
  username: null,
  displayName: 'Test',
  avatar: null,
  device: null,
});
const family: Circle = {
  id: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  kind: 'family',
  name: 'Aile',
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [ids.me, ids.bora, ids.can, ids.dana].map(member),
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
const point: MeetingPoint = {
  circleId: family.id,
  title: 'Aile',
  place: home,
  meetAt,
  state: 'set',
};
/** A location `metres` north of the place's centre, received a minute before `now`. */
function located(userId: string, metres: number, now: number, extra: Partial<LocPayload> = {}) {
  return {
    [`${family.id}:${userId}`]: {
      circleId: family.id,
      userId,
      receivedAt: now,
      loc: {
        kind: 'loc' as const,
        lat: home.lat + metres / 111_320,
        lng: home.lng,
        acc: 10,
        bat: 80,
        chg: false,
        ts: now - MIN,
        ...extra,
      },
    },
  };
}
const chip = (now: number) => (
  <MeetingChip circles={[family]} points={[point]} now={now} me={ids.me} />
);

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockVault.clear();
  useLocations.setState({}, true);
  useLates.setState({}, true);
  useArrived.setState({}, true);
  useMyFix.setState({ fix: null });
  useCelebration.setState({ pending: false });
});

const label = () => String(screen.getByTestId('meeting-chip').props.accessibilityLabel);

describe('the meeting chip on the map (docs/ADR/0026 §8)', () => {
  it('shows the place and time, and counts down in the last hour', async () => {
    const view = await render(chip(meetAt - 3 * 60 * MIN));
    expect(label()).toContain('🏠 Ev · ');
    expect(label()).not.toContain('dk');
    await view.rerender(chip(meetAt - 25 * MIN));
    expect(label()).toContain('· 25 dk');
    // Over and gone 3 hours after its time.
    await view.rerender(chip(meetAt + 3 * 60 * MIN));
    expect(screen.queryByTestId('meeting-chip')).toBeNull();
  });

  it('counts from its time by the meeting rules: a coarse sharer is in the total only', async () => {
    const now = meetAt + 5 * MIN;
    useLocations.setState({
      // Exact and inside: there.
      ...located(ids.can, 20, now),
      // Exact, with an estimate for this meeting: on the way.
      ...located(ids.dana, 2_000, now, { eta: { meetAt, at: meetAt + 10 * MIN } }),
      // Neighbourhood precision, its cell's centre inside the place: never "there"…
      ...located(ids.bora, 20, now, { acc: 708 }),
    });
    // …and its own "late" puts it on nobody's way count.
    useLates.setState({ [`${family.id}:${ids.bora}`]: { meetAt, minutes: 15, ts: now } });
    await render(chip(now));
    expect(label()).toContain('🏠 Ev · 1/4 geldi · 1 yolda');
  });

  it('celebrates once, only when everyone is there by an exact location', async () => {
    const now = meetAt + 5 * MIN;
    const others = { ...located(ids.can, 20, now), ...located(ids.dana, 30, now) };
    useMyFix.setState({
      fix: { lat: home.lat, lng: home.lng, acc: 10, spd: 0, hdg: null, ts: now - MIN },
    });
    // Bora there only by their own word: no effect.
    useLocations.setState(others, true);
    useArrived.setState({ [`${family.id}:${ids.bora}`]: { meetAt, ts: now } });
    const view = await render(chip(now));
    expect(label()).toContain(i18n.t('meeting.chip.everyone'));
    expect(useCelebration.getState().pending).toBe(false);

    // All four there by an exact location: once, and not again.
    await act(() => {
      useLocations.setState({ ...others, ...located(ids.bora, 40, now) });
    });
    await view.rerender(chip(now + MIN));
    expect(useCelebration.getState().pending).toBe(true);
    await act(() => {
      useCelebration.setState({ pending: false });
    });
    await view.rerender(chip(now + 2 * MIN));
    expect(useCelebration.getState().pending).toBe(false);
  });
});

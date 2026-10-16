import type { Circle } from '@bargu/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import i18n from '@/i18n';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const HOME = '0190f7a4-2222-7222-8222-000000000001';
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ circleId: CIRCLE }),
}));
const mockCircle: { current: Circle | undefined } = { current: undefined };
jest.mock('@/features/circles/queries', () => ({
  useCircle: () => mockCircle.current,
}));
const mockStart = jest.fn<Promise<boolean>, [unknown, unknown]>(() => Promise.resolve(true));
jest.mock('@/features/plan/plan-actions', () => ({
  startMeeting: (circle: unknown, meeting: unknown) => mockStart(circle, meeting),
  mayRunMeeting: () => false,
  endMeeting: jest.fn(),
  closePoll: jest.fn(),
  removePoll: jest.fn(),
  setMeeting: jest.fn(),
  vote: jest.fn(),
  votesOf: () => [],
}));
// The card's own parts (estimates, "I'm here") are not what this screen is about.
jest.mock('@/features/location/location-session', () => ({
  meetings: { eta: () => undefined, choices: () => ({}), setMode: jest.fn(), setRemind: jest.fn() },
  sayArrived: jest.fn(),
}));

import MeetingScreen from '@/app/(app)/meeting/[circleId]';
import { useAuth } from '@/features/auth/auth-store';
import { usePlaces } from '@/features/places/places';
import { docKey, useDocs } from '@/features/plan/docs';

const ME = '0190f7a4-1111-7111-8111-000000000001';
const family: Circle = {
  id: CIRCLE,
  kind: 'family',
  name: 'Aile',
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [],
};

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockCircle.current = family;
  useAuth.setState({ userId: ME });
  usePlaces.setState(
    {
      [HOME]: {
        id: HOME,
        circleId: CIRCLE,
        version: 1,
        name: 'Ev',
        emoji: '🏠',
        lat: 41.03,
        lng: 28.95,
        radius: 100,
        ts: 1,
      },
    },
    true,
  );
  useDocs.setState({}, true);
});

describe('a meeting on its own screen (docs/ADR/0026 §4)', () => {
  it('starts one in a circle that has none, at one of its places', async () => {
    await render(<MeetingScreen />);
    expect(screen.getByTestId('meeting-start')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`meeting-start-place-${HOME}`));
    await fireEvent.press(screen.getByTestId('meeting-start-go'));
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(family, {
        placeId: HOME,
        meetAt: expect.any(Number) as number,
      });
    });
  });

  it('shows where and when, and opens the maps app only on a tap', async () => {
    const meetAt = Date.now() + 3600_000;
    useDocs.setState({
      [docKey(CIRCLE, CIRCLE)]: {
        circleId: CIRCLE,
        version: 1,
        shared: true,
        authorId: ME,
        payload: { kind: 'plan', id: CIRCLE, meetAt, placeId: HOME, by: ME, ts: 1 },
      },
    });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<MeetingScreen />);
    expect(screen.getByTestId('meeting-screen')).toBeTruthy();
    expect(screen.getAllByText('Ev').length).toBeGreaterThan(0);
    expect(open).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('meeting-directions'));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('41.03,28.95'));
    open.mockRestore();
  });

  it('says so when the circle is gone', async () => {
    mockCircle.current = undefined;
    await render(<MeetingScreen />);
    expect(screen.getByText('Bu buluşma yok')).toBeTruthy();
  });
});

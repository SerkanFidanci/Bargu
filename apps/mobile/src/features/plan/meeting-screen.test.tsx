import type { Circle } from '@bargu/schemas';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

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
const mockAnswer = jest.fn<Promise<boolean>, [string, string]>(() => Promise.resolve(true));
const mockSet = jest.fn<Promise<boolean>, [string, unknown]>(() => Promise.resolve(true));
const mockMayRun = jest.fn<boolean, []>(() => false);
jest.mock('@/features/plan/plan-actions', () => ({
  startMeeting: (circle: unknown, meeting: unknown) => mockStart(circle, meeting),
  answerMeeting: (circleId: string, answer: string) => mockAnswer(circleId, answer),
  mayRunMeeting: () => mockMayRun(),
  endMeeting: jest.fn(),
  closePoll: jest.fn(),
  removePoll: jest.fn(),
  setMeeting: (circleId: string, change: unknown) => mockSet(circleId, change),
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
import { useMeetingPlaceDraft } from '@/features/plan/meeting-place';

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

const TAKSIM = { name: 'Taksim', lat: 41.037, lng: 28.985, radius: 250 };
const KADIKOY = { name: 'Kadıköy', lat: 40.99, lng: 29.03, radius: 250 };
const OFFICE = '0190f7a4-2222-7222-8222-000000000002';

/** The place editor hands back a spot picked for this meeting (forMeeting): nothing is saved. */
async function pickSpot(spot: typeof TAKSIM): Promise<void> {
  await act(() => {
    useMeetingPlaceDraft.setState({ circleId: CIRCLE, spot }, true);
  });
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockMayRun.mockReturnValue(false);
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

  it('takes a spot picked on the map for the meeting, which goes with it (ADR 0026 Ek 1)', async () => {
    await render(<MeetingScreen />);
    expect(screen.getByText('Haritadan nokta seç')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('meeting-start-add-place'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/place/[circleId]',
      params: { circleId: CIRCLE, forMeeting: '1' },
    });
    // The editor handed back a spot: it is chosen at once, and goes into the meeting itself.
    await pickSpot(TAKSIM);
    expect(within(screen.getByTestId('meeting-start-spot')).getByText('Taksim')).toBeTruthy();
    expect(screen.getByText('Yalnız bu buluşma için')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('meeting-start-go'));
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(family, {
        spot: TAKSIM,
        meetAt: expect.any(Number) as number,
      });
    });
    expect(useMeetingPlaceDraft.getState()).toBeNull();
  });

  it('takes the last spot picked; one left without starting leaves nothing (QA-36)', async () => {
    await render(<MeetingScreen />);
    await pickSpot(TAKSIM);
    await pickSpot(KADIKOY);
    expect(within(screen.getByTestId('meeting-start-spot')).getByText('Kadıköy')).toBeTruthy();
    expect(screen.queryByText('Taksim')).toBeNull();
    await screen.unmount();
    expect(mockStart).not.toHaveBeenCalled();
    expect(usePlaces.getState()).not.toHaveProperty('Kadıköy');
  });

  it('never lets a place the circle had go, nor one added for another circle', async () => {
    await render(<MeetingScreen />);
    await act(() => {
      useMeetingPlaceDraft.setState({ circleId: 'another', spot: TAKSIM }, true);
    });
    await fireEvent.press(screen.getByTestId(`meeting-start-place-${HOME}`));
    await fireEvent.press(screen.getByTestId('meeting-start-go'));
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(family, {
        placeId: HOME,
        meetAt: expect.any(Number) as number,
      });
    });
    useMeetingPlaceDraft.setState(null, true);
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

  it('lets its starter edit it: another place or a spot on the map (the owner, 2026-10-23)', async () => {
    mockMayRun.mockReturnValue(true);
    const meetAt = Date.now() + 3600_000;
    usePlaces.setState({
      [OFFICE]: {
        id: OFFICE,
        circleId: CIRCLE,
        version: 1,
        name: 'Ofis',
        emoji: '🏢',
        lat: 41.05,
        lng: 28.97,
        radius: 250,
        ts: 1,
      },
    });
    useDocs.setState({
      [docKey(CIRCLE, CIRCLE)]: {
        circleId: CIRCLE,
        version: 1,
        shared: true,
        authorId: ME,
        payload: { kind: 'plan', id: CIRCLE, meetAt, placeId: HOME, by: ME, ts: 1 },
      },
    });
    await render(<MeetingScreen />);
    await fireEvent.press(screen.getByTestId('meeting-edit'));
    expect(screen.getByTestId('meeting-form')).toBeTruthy();
    expect(screen.getByText('Buluşmayı düzenle')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`meeting-start-place-${OFFICE}`));
    await fireEvent.press(screen.getByTestId('meeting-start-go'));
    await waitFor(() => {
      expect(mockSet).toHaveBeenCalledWith(CIRCLE, { placeId: OFFICE, meetAt });
    });
    // Saved: back to the meeting.
    expect(await screen.findByTestId('meeting-screen')).toBeTruthy();
    // Again, to a spot picked on the map: it goes into the meeting itself.
    await fireEvent.press(screen.getByTestId('meeting-edit'));
    await pickSpot(TAKSIM);
    await fireEvent.press(screen.getByTestId('meeting-start-go'));
    await waitFor(() => {
      expect(mockSet).toHaveBeenLastCalledWith(CIRCLE, { spot: TAKSIM, meetAt });
    });
  });

  it('shows no "Düzenle" to whoever may not change it, and the starter can leave the form', async () => {
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
    const view = await render(<MeetingScreen />);
    expect(screen.queryByTestId('meeting-edit')).toBeNull();
    mockMayRun.mockReturnValue(true);
    await view.rerender(<MeetingScreen />);
    // "Düzenle" opens the form, and "Vazgeç" leaves it unchanged.
    await fireEvent.press(screen.getByTestId('meeting-edit'));
    expect(screen.getByTestId('meeting-form')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('meeting-form-cancel'));
    expect(screen.getByTestId('meeting-screen')).toBeTruthy();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('lets each member answer, and shows what the others said (ADR 0026 Ek 2)', async () => {
    const AYSE = '0190f7a4-1111-7111-8111-0000000000a5';
    const member = (userId: string, displayName: string) => ({
      userId,
      role: 'member' as const,
      status: 'active' as const,
      username: null,
      displayName,
      avatar: null,
      device: null,
    });
    mockCircle.current = { ...family, members: [member(ME, 'Ben'), member(AYSE, 'Ayşe')] };
    const meetAt = Date.now() + 3600_000;
    const ayseAnswer = '0190f7a4-3333-7333-8333-0000000000a5';
    useDocs.setState({
      [docKey(CIRCLE, CIRCLE)]: {
        circleId: CIRCLE,
        version: 1,
        shared: true,
        authorId: ME,
        payload: { kind: 'plan', id: CIRCLE, meetAt, placeId: HOME, by: ME, ts: 1 },
      },
      [docKey(CIRCLE, ayseAnswer)]: {
        circleId: CIRCLE,
        version: 1,
        shared: false,
        authorId: AYSE,
        payload: { kind: 'vote', id: ayseAnswer, pollId: CIRCLE, choices: [1], ts: 1 },
      },
    });
    await render(<MeetingScreen />);
    expect(screen.getByTestId('meeting-answers')).toBeTruthy();
    expect(within(screen.getByTestId(`meeting-answer-${AYSE}`)).getByText('Belki')).toBeTruthy();
    expect(screen.getByTestId('meeting-answer-counts')).toHaveTextContent('0 geliyor · 1 belki');
    await fireEvent.press(screen.getByRole('radio', { name: 'Geliyorum' }));
    expect(mockAnswer).toHaveBeenCalledWith(CIRCLE, 'going');
  });

  it('reads at a glance: where and when, then cards for the answer, who comes, the way and its end (the owner, 2026-10-23)', async () => {
    mockMayRun.mockReturnValue(true);
    mockCircle.current = {
      ...family,
      members: [
        {
          userId: ME,
          role: 'member',
          status: 'active',
          username: null,
          displayName: 'Ben',
          avatar: null,
          device: null,
        },
      ],
    };
    const meetAt = Date.now() + 90 * 60_000;
    useDocs.setState({
      [docKey(CIRCLE, CIRCLE)]: {
        circleId: CIRCLE,
        version: 1,
        shared: true,
        authorId: ME,
        payload: { kind: 'plan', id: CIRCLE, meetAt, placeId: HOME, by: ME, ts: 1 },
      },
    });
    await render(<MeetingScreen />);
    expect(screen.getByTestId('meeting-when')).toHaveTextContent(/1 sa 30 dk kaldı/);
    expect(screen.getByText('Buluşmayı sen başlattın.')).toBeTruthy();
    for (const card of ['meeting-answers', 'meeting-people', 'meeting-way', 'meeting-manage']) {
      expect(screen.getByTestId(card)).toBeTruthy();
    }
    // The actions side by side: the way there, edit, late, here.
    for (const tile of ['meeting-directions', 'meeting-edit', 'late-open', 'meeting-here']) {
      expect(screen.getByTestId(tile)).toBeTruthy();
    }
  });

  it('says so when the circle is gone', async () => {
    mockCircle.current = undefined;
    await render(<MeetingScreen />);
    expect(screen.getByText('Bu buluşma yok')).toBeTruthy();
  });
});

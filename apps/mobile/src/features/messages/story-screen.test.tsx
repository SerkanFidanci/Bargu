import type { Circle, MemberCard } from '@bargu/schemas';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, type AlertButton } from 'react-native';

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
const mockParams: { userId: string } = { userId: '' };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
const mockCircles: { current: Circle[] } = { current: [] };
jest.mock('@/features/circles/queries', () => ({
  useCircles: () => ({ data: mockCircles.current }),
}));
let mockScreenshot: (() => void) | null = null;
jest.mock('expo-screen-capture', () => ({
  useScreenshotListener: (listener: () => void) => {
    mockScreenshot = listener;
  },
}));
const mockOpen = jest.fn<Promise<string>, [{ blobId: string }]>(() =>
  Promise.resolve('data:image/jpeg;base64,AA=='),
);
jest.mock('@/features/messages/photo', () => ({
  openPhoto: (photo: { blobId: string }) => mockOpen(photo),
}));
const mockSendText = jest.fn<Promise<string>, [string, string, string?]>(() =>
  Promise.resolve('sent'),
);
const mockTakeBackPhoto = jest.fn<Promise<string>, [string]>(() => Promise.resolve('sent'));
const mockTellScreenshot = jest.fn<Promise<void>, [{ id: string }]>(() => Promise.resolve());
jest.mock('@/features/messages/outbox', () => ({
  sendText: (conversation: string, text: string, replyTo?: string) =>
    mockSendText(conversation, text, replyTo),
  takeBackPhoto: (blobId: string) => mockTakeBackPhoto(blobId),
  tellScreenshot: (item: { id: string }) => mockTellScreenshot(item),
}));
const mockViewed = jest.fn<undefined, [string]>();
jest.mock('@/features/messages/messages-session', () => ({
  loadMessagesOnce: () => true,
  markViewed: (blobId: string) => {
    mockViewed(blobId);
  },
  block: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/messages/report', () => ({ report: jest.fn(() => Promise.resolve(true)) }));
// Sade mod, as each test sets it.
const mockEffects: { level: 'full' | 'reduced' | 'off' } = { level: 'full' };
jest.mock('@/theme/effects', () => ({
  ...jest.requireActual<typeof import('@/theme/effects')>('@/theme/effects'),
  useEffects: () => mockEffects.level,
}));
// The community rules have their own tests (rules.test.tsx): here they are accepted.
jest.mock('@/features/messages/rules', () => ({
  useRulesGate: () => ({
    ensure: (action: () => void) => {
      action();
    },
    open: true,
    sheet: null,
  }),
}));

import StoryScreen from '@/app/(app)/story/[userId]';
import { useAuth } from '@/features/auth/auth-store';
import {
  type ChatItem,
  EMPTY_MESSAGES,
  useMessages,
  withItem,
  withViewed,
} from '@/features/messages/messages';

const ME = '0190f7a4-1111-7111-8111-000000000001';
const ALI = '0190f7a4-1111-7111-8111-000000000002';
const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const NOW = Date.now();

const member = (userId: string, displayName: string): MemberCard => ({
  userId,
  role: 'member',
  status: 'active',
  username: null,
  displayName,
  avatar: null,
  device: null,
});
const story = (
  id: string,
  from: string,
  blobId: string,
  at: number,
  caption?: string,
): ChatItem => ({
  id,
  conversation: `c:${CIRCLE}`,
  from,
  at,
  kind: 'photo',
  state: 'sent',
  photo: {
    blobId,
    key: 'k'.repeat(43),
    size: 1000,
    hash: 'h'.repeat(43),
    w: 10,
    h: 10,
    story: true,
    ...(caption === undefined ? {} : { caption }),
  },
});
const SEEN = story('0190f7a4-3333-7333-8333-000000000001', ALI, 'file-seen', NOW - 9000, 'sabah');
const NEW = story('0190f7a4-3333-7333-8333-000000000002', ALI, 'file-new', NOW - 5000, 'deniz');
const MINE = story('0190f7a4-3333-7333-8333-000000000003', ME, 'file-mine', NOW - 1000);

let alerts: { title: string; buttons: AlertButton[] }[] = [];

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  alerts = [];
  mockScreenshot = null;
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    alerts.push({ title, buttons: buttons ?? [] });
  });
  mockParams.userId = ALI;
  mockCircles.current = [
    {
      id: CIRCLE,
      kind: 'family',
      name: 'Aile',
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'member',
      myStatus: 'active',
      members: [member(ME, 'Ben'), member(ALI, 'Ali')],
    },
  ];
  useAuth.setState({ userId: ME });
  useMessages.setState(
    withViewed(
      [SEEN, NEW, MINE].reduce((state, item) => withItem(state, item), {
        ...EMPTY_MESSAGES,
        loaded: true,
      }),
      'file-seen',
      NOW - 8000,
    ),
    true,
  );
});

describe("someone's stories", () => {
  it('start at the first one not seen yet, which then counts as seen', async () => {
    await render(<StoryScreen />);
    expect(await screen.findByText('deniz')).toBeTruthy();
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ blobId: 'file-new' }));
    expect(mockViewed).toHaveBeenCalledWith('file-new');
  });

  it('go back with a tap on the left, and close after the last one', async () => {
    await render(<StoryScreen />);
    await fireEvent.press(screen.getByTestId('story-back'));
    expect(await screen.findByText('sabah')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('story-next'));
    await fireEvent.press(screen.getByTestId('story-next'));
    expect(router.back).toHaveBeenCalled();
  });

  it('take a reply to that person alone, answering this story', async () => {
    await render(<StoryScreen />);
    await screen.findByText('deniz');
    await fireEvent.changeText(screen.getByTestId('story-reply'), '  çok güzel ');
    await fireEvent.press(screen.getByTestId('story-reply-send'));
    expect(mockSendText).toHaveBeenCalledWith(`p:${ALI}`, 'çok güzel', NEW.id);
  });

  it('tell its sender of a screenshot, once', async () => {
    await render(<StoryScreen />);
    await screen.findByText('deniz');
    await act(() => {
      mockScreenshot?.();
      mockScreenshot?.();
    });
    expect(mockTellScreenshot).toHaveBeenCalledTimes(1);
    expect(mockTellScreenshot).toHaveBeenCalledWith(expect.objectContaining({ id: NEW.id }));
  });
});

describe("one's own story", () => {
  it('has no reply, never tells of a screenshot, and is taken back from every circle', async () => {
    mockParams.userId = ME;
    await render(<StoryScreen />);
    expect(screen.queryByTestId('story-reply')).toBeNull();
    await act(() => {
      mockScreenshot?.();
    });
    expect(mockTellScreenshot).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('story-more'));
    const button = alerts.at(-1)?.buttons.find((each) => each.text === 'Herkesten sil');
    await act(() => {
      button?.onPress?.();
    });
    expect(mockTakeBackPhoto).toHaveBeenCalledWith('file-mine');
  });
});

describe('sade mod "Kapalı" (QA-38)', () => {
  afterEach(() => {
    mockEffects.level = 'full';
    jest.useRealTimers();
  });

  it('keeps the bar still, and a pause keeps what was left of the time', async () => {
    mockEffects.level = 'off';
    jest.useFakeTimers();
    await render(<StoryScreen />);
    expect(await screen.findByText('deniz')).toBeTruthy();
    // Three of the five seconds, then a pause (writing a reply) as long as you like.
    await act(() => {
      jest.advanceTimersByTime(3_000);
    });
    await fireEvent(screen.getByTestId('story-reply'), 'focus');
    await act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('story-reply'), 'blur');
    // Two seconds were left, not five: just short of them it stays, at them it goes on.
    await act(() => {
      jest.advanceTimersByTime(1_900);
    });
    expect(router.back).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(router.back).toHaveBeenCalled();
  });
});

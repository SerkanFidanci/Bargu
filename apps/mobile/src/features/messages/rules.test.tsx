import {
  type Circle,
  COMMUNITY_RULES_URL,
  COMMUNITY_RULES_VERSION,
  type MemberCard,
  type RulesState,
} from '@bargu/schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking, Pressable, Text } from 'react-native';

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
const mockGet = jest.fn<Promise<RulesState>, []>();
const mockAccept = jest.fn<Promise<RulesState>, []>();
jest.mock('./rules-state', () => {
  const actual = jest.requireActual<typeof import('./rules-state')>('./rules-state');
  return { ...actual, rulesApi: { get: () => mockGet(), accept: () => mockAccept() } };
});
// The screens behind the gate, with what they reach for (each has its own tests).
const mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
const mockCircles: { current: Circle[] } = { current: [] };
jest.mock('@/features/circles/queries', () => ({
  useCircles: () => ({ data: mockCircles.current }),
  useCircleActions: () => ({ leave: { mutate: jest.fn() } }),
}));
const mockOutbox = {
  sendText: jest.fn(() => Promise.resolve('sent')),
  retry: jest.fn(() => Promise.resolve('sent')),
  takeBack: jest.fn(() => Promise.resolve('sent')),
  takeBackPhoto: jest.fn(() => Promise.resolve('sent')),
  tellScreenshot: jest.fn(() => Promise.resolve()),
  tellViewed: jest.fn(() => Promise.resolve()),
  sendPhoto: jest.fn(() => Promise.resolve('sent')),
  shareStory: jest.fn(() => Promise.resolve({ result: 'sent', failed: 0, total: 1 })),
};
// The conversation reads the mutes from the vault, which is not here (it has its own test).
jest.mock('@/features/notifications/mute-session', () => ({
  loadMuteSettings: () => ({ people: {}, places: {} }),
  updateMutes: jest.fn(),
}));
// The story screen tells once that its sender sees it opened; the vault is not here.
jest.mock('@/features/messages/view-notice', () => ({ firstViewNotice: () => false }));
jest.mock('@/features/messages/outbox', () => ({
  sendText: (...args: unknown[]) => mockOutbox.sendText(...(args as [])),
  retry: (...args: unknown[]) => mockOutbox.retry(...(args as [])),
  takeBack: (...args: unknown[]) => mockOutbox.takeBack(...(args as [])),
  takeBackPhoto: (...args: unknown[]) => mockOutbox.takeBackPhoto(...(args as [])),
  tellScreenshot: (...args: unknown[]) => mockOutbox.tellScreenshot(...(args as [])),
  tellViewed: (...args: unknown[]) => mockOutbox.tellViewed(...(args as [])),
  sendPhoto: (...args: unknown[]) => mockOutbox.sendPhoto(...(args as [])),
  shareStory: (...args: unknown[]) => mockOutbox.shareStory(...(args as [])),
}));
jest.mock('@/features/messages/messages-session', () => ({
  loadMessagesOnce: () => true,
  markRead: jest.fn(),
  markViewed: jest.fn(),
  block: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/messages/report', () => ({ report: jest.fn(() => Promise.resolve(true)) }));
const mockOpenPhoto = jest.fn(() => Promise.resolve('data:image/jpeg;base64,AQID'));
const mockCanResend = jest.fn(() => true);
jest.mock('@/features/messages/photo', () => ({
  openPhoto: () => mockOpenPhoto(),
  canResend: () => mockCanResend(),
  preparePhoto: () => Promise.resolve({ jpeg: new Uint8Array([1]), w: 10, h: 10 }),
  sealPhoto: () => ({
    blobId: '0190f7a4-4444-7444-8444-000000000001',
    key: 'k'.repeat(43),
    size: 100,
    hash: 'h'.repeat(43),
    w: 10,
    h: 10,
  }),
  jpegUri: () => 'data:image/jpeg;base64,AQ==',
}));
jest.mock('expo-screen-capture', () => ({ useScreenshotListener: jest.fn() }));
jest.mock('expo-camera', () => {
  const { createElement, forwardRef, useImperativeHandle } =
    jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
    CameraView: forwardRef(function MockCamera(_props: object, ref) {
      useImperativeHandle(ref, () => ({
        takePictureAsync: () =>
          Promise.resolve({ uri: 'file:///cache/a.jpg', width: 10, height: 10 }),
      }));
      return createElement(View);
    }),
  };
});

// The story editor draws with Skia (native): here it hands the photo straight on.
jest.mock('@/features/story-editor/story-editor', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    StoryEditor: ({ photo, onDone }: { photo: unknown; onDone: (photo: unknown) => void }) =>
      createElement(Pressable, {
        testID: 'story-editor-next',
        onPress: () => {
          onDone(photo);
        },
      }),
  };
});

import CameraScreen from '@/app/(app)/camera';
import MessagesScreen from '@/app/(app)/messages';
import ConversationScreen from '@/app/(app)/messages/[conversation]';
import PhotoScreen from '@/app/(app)/photo/[item]';
import StoryScreen from '@/app/(app)/story/[userId]';

import { ApiError } from '../auth/api-client';
import { useAuth } from '../auth/auth-store';
import { queryClient } from '../query-client';
import { useRulesGate } from './rules';
import { type ChatItem, EMPTY_MESSAGES, useMessages, withItem } from './messages';
import { forgetRules, rulesAccepted, rulesKey } from './rules-state';

const ACCEPTED: RulesState = { rules: { version: COMMUNITY_RULES_VERSION, at: 1 } };
const action = jest.fn();

function Composer() {
  const rules = useRulesGate();
  return (
    <>
      <Pressable
        testID="send"
        onPress={() => {
          rules.ensure(action);
        }}
      >
        <Text>Gönder</Text>
      </Pressable>
      {rules.sheet}
    </>
  );
}

const show = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <Composer />
    </QueryClientProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
afterAll(() => {
  queryClient.clear();
});
beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  useAuth.setState({ userId: '0190f7a4-1111-7111-8111-000000000001' });
});

describe('the community rules (K14)', () => {
  it('come before the first message: nothing goes until "Kabul ediyorum", then it does', async () => {
    mockGet.mockResolvedValue({ rules: null });
    mockAccept.mockResolvedValue(ACCEPTED);
    await show();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: rulesKey });
    });
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText(/24 saatte silinir/)).toBeTruthy();
    expect(screen.getByText('• taciz ve tehdit')).toBeTruthy();

    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByTestId('rules-full'));
    expect(open).toHaveBeenCalledWith(COMMUNITY_RULES_URL);
    expect(action).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('rules-accept'));
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(rulesAccepted(queryClient.getQueryData(rulesKey))).toBe(true);

    // Accepted once: the next message goes at once.
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).toHaveBeenCalledTimes(2);
    expect(mockAccept).toHaveBeenCalledTimes(1);
  });

  it('ask again when the server has no record of them, or an older version', async () => {
    mockGet.mockResolvedValue(ACCEPTED);
    await show();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: rulesKey });
    });
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).toHaveBeenCalledTimes(1);
    // The cache tells the screen on its next tick.
    await act(async () => {
      forgetRules();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await fireEvent.press(screen.getByTestId('send'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(rulesAccepted({ rules: { version: COMMUNITY_RULES_VERSION - 1, at: 1 } })).toBe(false);
  });

  it('say so when accepting fails, and send nothing', async () => {
    mockGet.mockResolvedValue({ rules: null });
    mockAccept.mockRejectedValue(new Error('offline'));
    await show();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: rulesKey });
    });
    await fireEvent.press(screen.getByTestId('send'));
    await fireEvent.press(screen.getByTestId('rules-accept'));
    expect(action).not.toHaveBeenCalled();
    expect(rulesAccepted(queryClient.getQueryData(rulesKey))).toBe(false);
  });
});

describe('the rules before any content and any sending (K14, QA-38b)', () => {
  const ME = '0190f7a4-1111-7111-8111-000000000001';
  const ALI = '0190f7a4-1111-7111-8111-000000000002';
  const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
  const member = (userId: string, displayName: string): MemberCard => ({
    userId,
    role: 'member',
    status: 'active',
    username: null,
    displayName,
    avatar: null,
    device: null,
  });
  const item = (id: string, overrides: Partial<ChatItem>): ChatItem => ({
    id,
    conversation: `c:${CIRCLE}`,
    from: ALI,
    at: Date.now() - 1000,
    kind: 'photo',
    state: 'sent',
    photo: {
      blobId: '0190f7a4-4444-7444-8444-000000000009',
      key: 'k'.repeat(43),
      size: 100,
      hash: 'h'.repeat(43),
      w: 10,
      h: 10,
      story: false,
      caption: 'deniz',
    },
    ...overrides,
  });
  const PHOTO = item('0190f7a4-3333-7333-8333-000000000001', {});
  const STORY = item('0190f7a4-3333-7333-8333-000000000002', {
    photo: { ...(PHOTO.photo ?? ({} as never)), story: true },
  });
  const FAILED = item('0190f7a4-3333-7333-8333-000000000003', {
    from: ME,
    kind: 'text',
    text: 'gitmedi',
    photo: undefined,
    state: 'failed',
  });
  const LOST = item('0190f7a4-3333-7333-8333-000000000004', { from: ME, state: 'failed' });

  const shown = (node: React.JSX.Element) =>
    render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  const settle = () =>
    act(async () => {
      await queryClient.refetchQueries({ queryKey: rulesKey });
    });
  const accept = async () => {
    await fireEvent.press(screen.getByTestId('rules-accept'));
  };

  beforeEach(() => {
    for (const key of Object.keys(mockParams)) mockParams[key] = undefined;
    mockCanResend.mockReturnValue(true);
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
    useMessages.setState(
      [PHOTO, STORY, FAILED, LOST].reduce((state, next) => withItem(state, next), {
        ...EMPTY_MESSAGES,
        loaded: true,
      }),
      true,
    );
    mockGet.mockResolvedValue({ rules: null });
    mockAccept.mockResolvedValue(ACCEPTED);
  });

  it('open the Messages section, and nothing of it shows before them', async () => {
    await shown(<MessagesScreen />);
    await settle();
    expect(screen.getByTestId('rules-accept')).toBeTruthy();
    expect(screen.queryByLabelText('Hikaye paylaş')).toBeNull();
    await accept();
    expect(screen.getByLabelText('Hikaye paylaş')).toBeTruthy();
  });

  it('come before a photo opens', async () => {
    mockParams.item = PHOTO.id;
    await shown(<PhotoScreen />);
    await settle();
    expect(mockOpenPhoto).not.toHaveBeenCalled();
    await accept();
    expect(await screen.findByText('deniz')).toBeTruthy();
    expect(mockOpenPhoto).toHaveBeenCalledTimes(1);
  });

  it('come before a story opens, and a reply to it goes after them', async () => {
    mockParams.userId = ALI;
    await shown(<StoryScreen />);
    await settle();
    expect(mockOpenPhoto).not.toHaveBeenCalled();
    await accept();
    expect(mockOpenPhoto).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(screen.getByTestId('story-reply'), 'güzel');
    await fireEvent.press(screen.getByTestId('story-reply-send'));
    expect(mockOutbox.sendText).toHaveBeenCalledWith(`p:${ALI}`, 'güzel', STORY.id);
  });

  // The server could not be asked (offline): what the phone holds shows, sending waits. Each
  // starts there: forgetting the rules in the middle also hides the conversation, and whether its
  // item was still drawn for the tap then depended on timing (CI, 2026-10-28).
  const offline = async () => {
    mockGet.mockRejectedValue(new ApiError(500, 'INTERNAL'));
    mockParams.conversation = `c:${CIRCLE}`;
    mockCanResend.mockReturnValue(false);
    await shown(<ConversationScreen />);
    await settle();
  };

  it('come before trying a failed item again', async () => {
    await offline();
    // The list draws its items a moment after the screen (FlatList).
    await fireEvent.press(await screen.findByTestId(`item-${FAILED.id}`));
    expect(mockOutbox.retry).not.toHaveBeenCalled();
    await accept();
    expect(mockOutbox.retry).toHaveBeenCalledWith(FAILED.id);
  });

  it('come before taking a lost photo again', async () => {
    await offline();
    await fireEvent.press(await screen.findByTestId(`item-${LOST.id}`));
    expect(mockOutbox.takeBack).not.toHaveBeenCalled();
    await accept();
    expect(mockOutbox.takeBack).toHaveBeenCalledWith(LOST.id);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/camera',
      params: { to: `c:${CIRCLE}` },
    });
  });

  it('come before a photo from the camera goes', async () => {
    await shown(<CameraScreen />);
    await settle();
    await fireEvent.press(screen.getByTestId('camera-take'));
    await fireEvent.press(await screen.findByTestId('story-editor-next'));
    await screen.findByTestId('camera-send');
    await fireEvent.press(screen.getByTestId('camera-pick-person'));
    await fireEvent.press(screen.getByTestId(`camera-person-${ALI}`));
    expect(mockOutbox.sendPhoto).not.toHaveBeenCalled();
    await accept();
    expect(mockOutbox.sendPhoto).toHaveBeenCalledWith(`p:${ALI}`, expect.anything(), undefined);
  });
});

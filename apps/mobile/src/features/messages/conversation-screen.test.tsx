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
const mockParams: { conversation: string } = { conversation: '' };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
const mockCircles: { current: Circle[] } = { current: [] };
jest.mock('@/features/circles/queries', () => ({
  useCircles: () => ({ data: mockCircles.current }),
}));
// Sending, taking back, reporting and the live session have their own tests.
const mockSendText = jest.fn<Promise<string>, [string, string]>(() => Promise.resolve('sent'));
const mockTakeBack = jest.fn<Promise<string>, [string]>(() => Promise.resolve('sent'));
jest.mock('@/features/messages/outbox', () => ({
  sendText: (conversation: string, text: string) => mockSendText(conversation, text),
  takeBack: (id: string) => mockTakeBack(id),
  retry: jest.fn(),
}));
const mockMarkRead = jest.fn<undefined, [string, number]>();
const mockBlock = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
jest.mock('@/features/messages/messages-session', () => ({
  loadMessagesOnce: () => true,
  markRead: (conversation: string, at: number) => {
    mockMarkRead(conversation, at);
  },
  block: (userId: string) => mockBlock(userId),
}));
jest.mock('@/features/messages/report', () => ({ report: jest.fn(() => Promise.resolve(true)) }));
// The community rules have their own tests (rules.test.tsx): here they are accepted.
jest.mock('@/features/messages/rules', () => ({
  useRulesGate: () => ({
    ensure: (action: () => void) => {
      action();
    },
    sheet: null,
  }),
}));

import MessagesScreen from '@/app/(app)/messages';
import ConversationScreen from '@/app/(app)/messages/[conversation]';
import { useAuth } from '@/features/auth/auth-store';
import { type ChatItem, EMPTY_MESSAGES, useMessages, withItem } from '@/features/messages/messages';

const ME = '0190f7a4-1111-7111-8111-000000000001';
const ALI = '0190f7a4-1111-7111-8111-000000000002';
const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const NOW = 1_800_000_000_000;

const member = (userId: string, displayName: string): MemberCard => ({
  userId,
  role: 'member',
  status: 'active',
  username: null,
  displayName,
  avatar: null,
  device: null,
});
const family: Circle = {
  id: CIRCLE,
  kind: 'family',
  name: 'Aile',
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [member(ME, 'Ben'), member(ALI, 'Ali')],
};
const item = (id: string, from: string, text: string, at: number, conversation = `c:${CIRCLE}`) =>
  ({ id, conversation, from, at, kind: 'text', text, state: 'sent' }) as ChatItem;
const ITEM_ALI = '0190f7a4-3333-7333-8333-000000000001';
const ITEM_MINE = '0190f7a4-3333-7333-8333-000000000002';

let alerts: { title: string; message: string | undefined; buttons: AlertButton[] }[] = [];
const pressAlert = async (label: string) => {
  const button = alerts.at(-1)?.buttons.find((candidate) => candidate.text === label);
  if (button?.onPress === undefined) throw new Error(`no button ${label}`);
  await act(() => {
    button.onPress?.();
  });
};

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    alerts.push({ title, message, buttons: buttons ?? [] });
  });
  mockParams.conversation = `c:${CIRCLE}`;
  mockCircles.current = [family];
  useAuth.setState({ userId: ME });
  useMessages.setState(
    [
      item(ITEM_ALI, ALI, 'Neredesin?', NOW - 2000),
      item(ITEM_MINE, ME, 'Yoldayım', NOW - 1000),
    ].reduce((state, next) => withItem(state, next), { ...EMPTY_MESSAGES, loaded: true }),
    true,
  );
});

describe('a conversation', () => {
  it('shows the circle, who wrote what, and marks it read up to the newest item', async () => {
    await render(<ConversationScreen />);
    expect(screen.getByText('Aile')).toBeTruthy();
    expect(screen.getByText('Ali')).toBeTruthy();
    expect(screen.getByText('Neredesin?')).toBeTruthy();
    expect(screen.getByText('Yoldayım')).toBeTruthy();
    expect(mockMarkRead).toHaveBeenCalledWith(`c:${CIRCLE}`, NOW - 1000);
  });

  it('sends what is written, without the spaces around it, and empties the field', async () => {
    await render(<ConversationScreen />);
    await fireEvent.changeText(screen.getByTestId('conversation-input'), '  geliyorum  ');
    await fireEvent.press(screen.getByTestId('conversation-send'));
    expect(mockSendText).toHaveBeenCalledWith(`c:${CIRCLE}`, 'geliyorum');
    expect(screen.getByTestId('conversation-input').props.value).toBe('');
  });

  it('takes one own item back from everyone after asking', async () => {
    await render(<ConversationScreen />);
    await fireEvent(screen.getByTestId(`item-${ITEM_MINE}`), 'longPress');
    expect(alerts.at(-1)?.title).toBe('Herkesten sil');
    await pressAlert('Herkesten sil');
    expect(mockTakeBack).toHaveBeenCalledWith(ITEM_MINE);
  });

  it('blocks a sender only after saying it does not hide the location, with leaving right there', async () => {
    await render(<ConversationScreen />);
    await fireEvent(screen.getByTestId(`item-${ITEM_ALI}`), 'longPress');
    await pressAlert('Engelle');
    const asked = alerts.at(-1);
    expect(asked?.message).toBe(
      'Engellemek konumunu gizlemez. Konumunu gizlemek için çemberden ayrıl.',
    );
    expect(asked?.buttons.map((button) => button.text)).toEqual([
      'Engelle',
      'Çemberden ayrıl',
      'Vazgeç',
    ]);
    await pressAlert('Çemberden ayrıl');
    expect(router.push).toHaveBeenCalledWith(`/circle/${CIRCLE}`);
    expect(mockBlock).not.toHaveBeenCalled();
  });

  it('can no longer be written to once the circle is gone', async () => {
    mockCircles.current = [];
    await render(<ConversationScreen />);
    expect(screen.queryByTestId('conversation-input')).toBeNull();
    expect(screen.getByText('Bu sohbet artık açık değil: ortak çemberiniz kalmadı.')).toBeTruthy();
  });
});

describe('the list of messages', () => {
  it('shows stories first: sharing one, then whoever has one, which opens them', async () => {
    useMessages.setState((state) =>
      withItem(state, {
        id: '0190f7a4-3333-7333-8333-000000000009',
        conversation: `c:${CIRCLE}`,
        from: ALI,
        at: NOW - 500,
        kind: 'photo',
        state: 'sent',
        photo: {
          blobId: '0190f7a4-4444-7444-8444-000000000009',
          key: 'k'.repeat(43),
          size: 1000,
          hash: 'h'.repeat(43),
          w: 10,
          h: 10,
          story: true,
        },
      }),
    );
    await render(<MessagesScreen />);
    expect(screen.getByLabelText('Hikaye paylaş')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Ali: yeni hikaye'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/story/[userId]',
      params: { userId: ALI },
    });
    // The story is not an item of the circle's conversation.
    expect(screen.getByText('Sen: Yoldayım')).toBeTruthy();
  });
});

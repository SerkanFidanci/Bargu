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
const mockParams: Record<string, string | undefined> = {};
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
const mockPermission: { current: { granted: boolean; canAskAgain: boolean } } = {
  current: { granted: true, canAskAgain: true },
};
const mockRequest = jest.fn();
jest.mock('expo-camera', () => {
  const { createElement, forwardRef, useImperativeHandle } =
    jest.requireActual<typeof import('react')>('react');
  const { View: Box } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [mockPermission.current, mockRequest],
    CameraView: forwardRef(function MockCamera(_props: object, ref) {
      useImperativeHandle(ref, () => ({
        takePictureAsync: () =>
          Promise.resolve({ uri: 'file:///cache/shot.jpg', width: 4000, height: 3000 }),
      }));
      return createElement(Box, { testID: 'camera-view' });
    }),
  };
});
const mockFile = {
  blobId: '0190f7a4-4444-7444-8444-000000000001',
  key: 'k'.repeat(43),
  size: 1000,
  hash: 'h'.repeat(43),
  w: 1600,
  h: 1200,
};
const mockPrepare = jest.fn(() =>
  Promise.resolve({ jpeg: new Uint8Array([1, 2, 3]), w: 1600, h: 1200 }),
);
jest.mock('@/features/messages/photo', () => ({
  preparePhoto: () => mockPrepare(),
  sealPhoto: () => mockFile,
  jpegUri: () => 'data:image/jpeg;base64,AQID',
  openPhoto: () => Promise.resolve('data:image/jpeg;base64,AQID'),
}));
const mockSendPhoto = jest.fn<Promise<string>, [string, unknown, string?]>(() =>
  Promise.resolve('sent'),
);
const mockShareStory = jest.fn<Promise<string>, [string[], unknown, string?]>(() =>
  Promise.resolve('sent'),
);
const mockTakeBack = jest.fn<Promise<string>, [string]>(() => Promise.resolve('sent'));
const mockTellScreenshot = jest.fn<Promise<void>, [{ id: string }]>(() => Promise.resolve());
// The editor between the shot and the sending has its own tests (story-editor.test.tsx): here it
// hands back an edited photo, or goes back to the camera.
const mockEdited = { jpeg: new Uint8Array([7]), w: 1600, h: 1200 };
jest.mock('@/features/story-editor/story-editor', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Pressable, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    StoryEditor: ({
      onDone,
      onCancel,
    }: {
      onDone: (photo: typeof mockEdited) => void;
      onCancel: () => void;
    }) =>
      createElement(View, { testID: 'story-editor' }, [
        createElement(Pressable, {
          key: 'next',
          testID: 'story-editor-next',
          onPress: () => {
            onDone(mockEdited);
          },
        }),
        createElement(Pressable, { key: 'close', testID: 'story-editor-close', onPress: onCancel }),
      ]),
  };
});
jest.mock('@/features/messages/outbox', () => ({
  sendPhoto: (conversation: string, file: unknown, caption?: string) =>
    mockSendPhoto(conversation, file, caption),
  shareStory: (circleIds: string[], file: unknown, caption?: string) =>
    mockShareStory(circleIds, file, caption),
  takeBack: (id: string) => mockTakeBack(id),
  tellScreenshot: (item: { id: string }) => mockTellScreenshot(item),
}));
jest.mock('@/features/messages/messages-session', () => ({
  loadMessagesOnce: () => true,
  block: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/messages/report', () => ({ report: jest.fn(() => Promise.resolve(true)) }));
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

import CameraScreen from '@/app/(app)/camera';
import PhotoScreen from '@/app/(app)/photo/[item]';
import { useAuth } from '@/features/auth/auth-store';
import { type ChatItem, EMPTY_MESSAGES, useMessages, withItem } from '@/features/messages/messages';

const ME = '0190f7a4-1111-7111-8111-000000000001';
const ALI = '0190f7a4-1111-7111-8111-000000000002';
const FAMILY = '0190f7a4-5b6c-7d8e-9f01-000000000001';
const PARTY = '0190f7a4-5b6c-7d8e-9f01-000000000002';
const ITEM = '0190f7a4-3333-7333-8333-000000000001';

const member = (userId: string, displayName: string): MemberCard => ({
  userId,
  role: 'member',
  status: 'active',
  username: null,
  displayName,
  avatar: null,
  device: null,
});
const circle = (id: string, kind: Circle['kind'], name: string): Circle => ({
  id,
  kind,
  name,
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [member(ME, 'Ben'), member(ALI, 'Ali')],
});
const photoItem = (from: string, shotBy?: string[]): ChatItem => ({
  id: ITEM,
  conversation: `c:${FAMILY}`,
  from,
  at: Date.now() - 1000,
  kind: 'photo',
  state: 'sent',
  photo: { ...mockFile, story: false, caption: 'deniz' },
  ...(shotBy === undefined ? {} : { shotBy }),
});

let alerts: { title: string; buttons: AlertButton[] }[] = [];
const press = async (label: string) => {
  const button = alerts.at(-1)?.buttons.find((each) => each.text === label);
  await act(() => {
    button?.onPress?.();
  });
};

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  alerts = [];
  mockScreenshot = null;
  for (const key of Object.keys(mockParams)) mockParams[key] = undefined;
  mockPermission.current = { granted: true, canAskAgain: true };
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    alerts.push({ title, buttons: buttons ?? [] });
  });
  mockCircles.current = [circle(FAMILY, 'family', 'Aile'), circle(PARTY, 'event', 'Doğum günü')];
  useAuth.setState({ userId: ME });
  useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
});

describe('a photo of a conversation', () => {
  it("someone else's: opens with its caption and tells its sender of a screenshot once", async () => {
    useMessages.setState((state) => withItem(state, photoItem(ALI)));
    mockParams.item = ITEM;
    await render(<PhotoScreen />);
    expect(await screen.findByText('deniz')).toBeTruthy();
    expect(screen.getByText('Ali')).toBeTruthy();
    await act(() => {
      mockScreenshot?.();
      mockScreenshot?.();
    });
    expect(mockTellScreenshot).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('photo-more'));
    expect(alerts.at(-1)?.buttons.map((each) => each.text)).toEqual([
      'Bildir',
      'Engelle',
      'Vazgeç',
    ]);
  });

  it('one’s own: who took a screenshot, and taken back from everyone', async () => {
    useMessages.setState((state) => withItem(state, photoItem(ME, [ALI])));
    mockParams.item = ITEM;
    await render(<PhotoScreen />);
    expect(await screen.findByText('Ekran görüntüsü aldı: Ali')).toBeTruthy();
    await act(() => {
      mockScreenshot?.();
    });
    expect(mockTellScreenshot).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('photo-more'));
    await press('Herkesten sil');
    expect(mockTakeBack).toHaveBeenCalledWith(ITEM);
  });

  it('says so when its 24 hours are over', async () => {
    mockParams.item = ITEM;
    await render(<PhotoScreen />);
    expect(screen.getByText('Bu fotoğrafın 24 saati doldu.')).toBeTruthy();
  });
});

describe('the camera', () => {
  const takeOne = async () => {
    await render(<CameraScreen />);
    await fireEvent.press(screen.getByTestId('camera-take'));
    await fireEvent.press(await screen.findByTestId('story-editor-next'));
    await screen.findByTestId('camera-send');
  };

  it('edits the photo between the shot and the sending, and goes back to the camera from it', async () => {
    await render(<CameraScreen />);
    await fireEvent.press(screen.getByTestId('camera-take'));
    expect(await screen.findByTestId('story-editor')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('story-editor-close'));
    expect(screen.getByTestId('camera')).toBeTruthy();
  });

  it('turns the flash off, on and to auto', async () => {
    await render(<CameraScreen />);
    const flash = () => screen.getByTestId('camera-flash').props.accessibilityLabel as string;
    expect(flash()).toBe('Flaş: kapalı');
    await fireEvent.press(screen.getByTestId('camera-flash'));
    expect(flash()).toBe('Flaş: açık');
    await fireEvent.press(screen.getByTestId('camera-flash'));
    expect(flash()).toBe('Flaş: otomatik');
  });

  it('asks for the camera first, saying it never looks at the gallery', async () => {
    mockPermission.current = { granted: false, canAskAgain: true };
    await render(<CameraScreen />);
    expect(screen.getByText(/galerine bakmaz/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Kameraya izin ver'));
    expect(mockRequest).toHaveBeenCalled();
  });

  it('shares a story to every circle but events, with its caption', async () => {
    await takeOne();
    expect(mockPrepare).toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('camera-caption'), ' deniz ');
    await fireEvent.press(screen.getByTestId('camera-story'));
    expect(mockShareStory).toHaveBeenCalledWith([FAMILY], mockFile, 'deniz');
    expect(router.back).toHaveBeenCalled();
  });

  it('lets an event be chosen by hand', async () => {
    await takeOne();
    await fireEvent.press(screen.getByTestId('camera-pick-circles'));
    await fireEvent(screen.getByTestId(`camera-circle-${PARTY}`), 'onChange', true);
    await fireEvent.press(screen.getByTestId('camera-share-chosen'));
    expect(mockShareStory).toHaveBeenCalledWith([PARTY], mockFile, undefined);
  });

  it('sends to one person as a photo, not a story', async () => {
    await takeOne();
    await fireEvent.press(screen.getByTestId('camera-pick-person'));
    await fireEvent.press(screen.getByTestId(`camera-person-${ALI}`));
    expect(mockSendPhoto).toHaveBeenCalledWith(`p:${ALI}`, mockFile, undefined);
    expect(mockShareStory).not.toHaveBeenCalled();
  });

  it('opened from a conversation, sends there', async () => {
    mockParams.to = `c:${FAMILY}`;
    await takeOne();
    await fireEvent.press(screen.getByTestId('camera-send-here'));
    expect(mockSendPhoto).toHaveBeenCalledWith(`c:${FAMILY}`, mockFile, undefined);
  });
});

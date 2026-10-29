import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import type { Edit } from './edit-model';

// Skia draws natively; here its parts are plain views and its objects stubs (compose.ts, which
// draws the photo, has its own place in the phone checks).
jest.mock('@shopify/react-native-skia', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const path = () => ({
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    reset: jest.fn(),
    toSVGString: () => '',
  });
  return {
    Canvas: ({ children }: { children?: import('react').ReactNode }) =>
      createElement(View, { testID: 'skia-canvas' }, children),
    Image: () => null,
    ColorMatrix: () => null,
    Path: () => null,
    notifyChange: jest.fn(),
    Skia: {
      Image: { MakeImageFromEncoded: () => ({}) },
      Data: { fromBytes: () => ({}) },
      Path: { Make: path },
    },
  };
});
const mockCompose = jest.fn<unknown, [unknown, Edit, unknown]>(() => ({
  jpeg: new Uint8Array([9]),
  w: 1200,
  h: 1600,
}));
jest.mock('./compose', () => ({
  TEXT_WIDTH: 0.85,
  BOX_PAD: 8,
  BOX_RADIUS: 10,
  composeEdit: (photo: unknown, edit: Edit, display: unknown) => mockCompose(photo, edit, display),
}));

import { StoryEditor } from './story-editor';

const photo = { jpeg: new Uint8Array([1, 2, 3]), w: 1200, h: 1600 };

async function editor() {
  const onDone = jest.fn();
  const onCancel = jest.fn();
  await render(<StoryEditor photo={photo} onDone={onDone} onCancel={onCancel} />);
  // The stage is measured once it is drawn: give it a size as the phone would.
  await fireEvent(screen.getByTestId('story-editor').children[0] as never, 'layout', {
    nativeEvent: { layout: { width: 360, height: 640 } },
  });
  return { onDone, onCancel };
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the story editor (the owner, 2026-10-29: "Instagram gibi")', () => {
  it('sends the photo as it was when nothing was done to it', async () => {
    const { onDone } = await editor();
    await fireEvent.press(screen.getByTestId('story-editor-next'));
    expect(onDone).toHaveBeenCalledWith(photo);
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it('puts words on it, in a colour and on a box, and draws them into the photo', async () => {
    const { onDone } = await editor();
    await fireEvent.press(screen.getByTestId('story-editor-text'));
    await fireEvent.changeText(screen.getByTestId('story-editor-input'), '  merhaba  ');
    await fireEvent.press(screen.getByTestId('story-editor-color-2'));
    await fireEvent.press(screen.getByTestId('story-editor-boxed'));
    await fireEvent.press(screen.getByTestId('story-editor-text-done'));
    expect(screen.getByText('merhaba')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('story-editor-next'));
    await jest.runAllTimersAsync();
    const edit = mockCompose.mock.calls[0]?.[1];
    expect(edit?.overlays).toEqual([
      expect.objectContaining({ kind: 'text', text: 'merhaba', color: '#F5D90A', boxed: true }),
    ]);
    expect(onDone).toHaveBeenCalledWith({ jpeg: new Uint8Array([9]), w: 1200, h: 1600 });
  });

  it('adds a sticker from the list, and nothing that tells a place', async () => {
    await editor();
    await fireEvent.press(screen.getByTestId('story-editor-sticker'));
    expect(screen.queryByTestId('story-editor-sticker-📍')).toBeNull();
    await fireEvent.press(screen.getByTestId('story-editor-sticker-🔥'));
    expect(screen.queryByTestId('story-editor-stickers')).toBeNull();
    expect(screen.getByLabelText('🔥')).toBeTruthy();
  });

  it('opens a pen with colours and widths, undo off until something is drawn', async () => {
    await editor();
    await fireEvent.press(screen.getByTestId('story-editor-draw'));
    expect(screen.getByTestId('story-editor-undo').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByTestId('story-editor-width-2'));
    expect(screen.getByTestId('story-editor-width-2').props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByTestId('story-editor-draw-done'));
    expect(screen.getByTestId('story-editor-next')).toBeTruthy();
  });

  it('goes back to the camera from the ×', async () => {
    const { onCancel } = await editor();
    await fireEvent.press(screen.getByTestId('story-editor-close'));
    expect(onCancel).toHaveBeenCalled();
  });
});

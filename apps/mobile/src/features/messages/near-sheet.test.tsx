import type { Circle } from '@bargu/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { useToasts } from '@/ui/toast';

import { DEFAULT_SHARING, useSharing } from '../location/sharing';
import { circleOf, somebody } from '../location/test-support';
import { EMPTY_MESSAGES, useMessages, withItem } from './messages';

const mockMe = somebody();
const ali = somebody();
const cem = somebody();
const home = circleOf([mockMe, ali, cem], { name: 'Aile' });
const club = circleOf([mockMe, ali], { name: 'Kulüp' });
let mockCircles: Circle[] = [home, club];
const mockSendNear = jest.fn<Promise<string>, [string]>(() => Promise.resolve('sent'));

jest.mock('../auth/auth-store', () => ({
  useAuth: (select: (state: { userId: string }) => unknown) => select({ userId: mockMe.userId }),
}));
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: mockCircles }) }));
jest.mock('./outbox', () => ({
  sendNear: (conversation: string) => mockSendNear(conversation),
}));

import { NearSheet } from './near-sheet';

const toastNow = () => useToasts.getState().current;
const checked = (circle: Circle) =>
  (screen.getByTestId(`near-circle-${circle.id}`).props.accessibilityState as { checked: boolean })
    .checked;

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockCircles = [home, club];
  useSharing.setState(DEFAULT_SHARING, true);
  useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
  useToasts.setState({ current: null });
});

describe('the "Yakındayım" sheet (docs/ADR/0037 §6)', () => {
  it('ticks none of several places: the user chooses, then one tap tells them and closes', async () => {
    const onClose = jest.fn();
    await render(<NearSheet onClose={onClose} />);
    expect(checked(home)).toBe(false);
    expect(checked(club)).toBe(false);
    expect(screen.getByTestId('near-send').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByTestId(`near-circle-${home.id}`));
    expect(screen.getByTestId('near-send').props.accessibilityLabel).toBe('Haber ver (1)');
    await fireEvent.press(screen.getByTestId('near-send'));
    expect(mockSendNear).toHaveBeenCalledWith(`c:${home.id}`);
    expect(toastNow()).toMatchObject({ message: 'Haber verildi: Test ve 1 kişi', tone: 'success' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ticks the one place there is, and says when a place told a moment ago can be told again', async () => {
    mockCircles = [home];
    const { unmount } = await render(<NearSheet onClose={jest.fn()} />);
    expect(checked(home)).toBe(true);
    await unmount();
    useMessages.setState(
      withItem(
        { ...EMPTY_MESSAGES, loaded: true },
        {
          id: 'n1',
          conversation: `c:${home.id}`,
          from: mockMe.userId,
          at: Date.now() - 3 * 60_000,
          kind: 'near',
          state: 'sent',
        },
      ),
      true,
    );
    await render(<NearSheet onClose={jest.fn()} />);
    expect(screen.getByText('7 dk sonra tekrar')).toBeTruthy();
    expect(checked(home)).toBe(false);
    expect(screen.getByTestId('near-send').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('says why nothing can go: a ghost, or no place it can go', async () => {
    useSharing.setState({ ...DEFAULT_SHARING, ghost: 'hide' }, true);
    const { unmount } = await render(<NearSheet onClose={jest.fn()} />);
    expect(screen.getByText('Hayalet modundayken gönderilemez.')).toBeTruthy();
    await unmount();
    useSharing.setState(DEFAULT_SHARING, true);
    mockCircles = [circleOf([mockMe, ali], { kind: 'event', name: 'Konser' })];
    await render(<NearSheet onClose={jest.fn()} />);
    expect(screen.getByTestId('near-none')).toBeTruthy();
  });

  it('says it did not go, and stays open', async () => {
    mockSendNear.mockResolvedValueOnce('limited');
    const onClose = jest.fn();
    mockCircles = [club];
    await render(<NearSheet onClose={onClose} />);
    await fireEvent.press(screen.getByTestId('near-send'));
    expect(toastNow()).toMatchObject({
      message: 'Şimdilik çok fazla gönderdin, biraz sonra tekrar dene.',
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

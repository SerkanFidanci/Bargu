import type { Circle } from '@bargu/schemas';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import i18n from '@/i18n';
import { useToasts } from '@/ui/toast';

import { DEFAULT_SHARING, useSharing } from '../location/sharing';
import { circleOf, nth, somebody } from '../location/test-support';
import type { SafeReport } from './safe';

const mockAyse = somebody();
const bora = somebody();
const home = circleOf([mockAyse, bora], { name: 'Aile' });
const club = circleOf([mockAyse, bora], { name: 'Kulüp' });
const mockTell = jest.fn<Promise<SafeReport>, [string[]]>();
const mockRemembered = jest.fn<string[] | null, []>(() => null);
let mockCircles: Circle[] = [home, club];

jest.mock('../auth/auth-store', () => ({
  useAuth: (select: (state: { userId: string }) => unknown) => select({ userId: mockAyse.userId }),
}));
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: mockCircles }) }));
jest.mock('./safe-session', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    safeCheckIns: { tell: (ids: string[]) => mockTell(ids) },
    rememberedChoice: () => mockRemembered(),
    useSafeWaiting: create(() => ({ count: 0 })),
  };
});

import { SafeSheet } from './safe-sheet';
import { useSafeWaiting } from './safe-session';

const sent: SafeReport = { status: 'sent', sent: 1, waiting: 0, limited: 0 };
const toastNow = () => useToasts.getState().current;

function sheet(onClose = jest.fn()) {
  return <SafeSheet onClose={onClose} />;
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockCircles = [home, club];
  mockRemembered.mockReturnValue(null);
  mockTell.mockResolvedValue(sent);
  useSharing.setState(DEFAULT_SHARING, true);
  useSafeWaiting.setState({ count: 0 });
  useToasts.setState({ current: null });
});

describe('the Güvendeyim sheet (docs/ADR/0029)', () => {
  it('lists the circles, ticks last time’s choice and labels the one that gets a coarse place', async () => {
    useSharing.setState(
      {
        ...DEFAULT_SHARING,
        circles: { [club.id]: { sharing: true, precision: 'city', until: null } },
      },
      true,
    );
    mockRemembered.mockReturnValue([club.id]);
    await render(sheet());

    expect(screen.getByText('Aile')).toBeTruthy();
    expect(screen.getByText('Kulüp')).toBeTruthy();
    expect(screen.getByText('yaklaşık konum')).toBeTruthy();
    expect(screen.getByTestId(`safe-circle-${club.id}`).props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId(`safe-circle-${home.id}`).props.accessibilityState).toMatchObject({
      checked: false,
    });
    expect(screen.getByTestId('safe-send').props.accessibilityLabel).toBe('İyiyim, gönder (1)');
  });

  it('sends to the ticked circles in one tap, says so, and closes', async () => {
    const onClose = jest.fn();
    await render(sheet(onClose));
    // Nothing remembered: the circles that already see the location are ticked.
    await fireEvent.press(screen.getByTestId(`safe-circle-${club.id}`));
    await fireEvent.press(screen.getByTestId('safe-send'));

    expect(mockTell).toHaveBeenCalledWith([home.id]);
    expect(toastNow()).toMatchObject({ message: 'İyiyim gönderildi ✓', tone: 'success' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks first when a ghost is on, and sends nothing unless the user says yes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useSharing.setState({ ...DEFAULT_SHARING, ghost: 'hide' }, true);
    mockRemembered.mockReturnValue([home.id]);
    const onClose = jest.fn();
    await render(sheet(onClose));
    // Both circles are marked: a ghost is seen by none.
    expect(screen.getAllByText('konum şu an paylaşılmıyor')).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(alert).toHaveBeenCalledWith(
      'Konumun bu kez paylaşılacak',
      expect.stringContaining('hayalet modun'),
      expect.any(Array),
    );
    expect(mockTell).not.toHaveBeenCalled();
    const buttons = nth(alert.mock.calls)[2] ?? [];
    // "Vazgeç": nothing happens.
    await act(() => {
      buttons.find((button) => button.style === 'cancel')?.onPress?.();
    });
    expect(mockTell).not.toHaveBeenCalled();
    // "Gönder": it goes, and the ghost mode is as it was.
    await act(() => {
      buttons.find((button) => button.style !== 'cancel')?.onPress?.();
    });
    expect(mockTell).toHaveBeenCalledWith([home.id]);
    expect(useSharing.getState().ghost).toBe('hide');
    alert.mockRestore();
  });

  it('does not ask when every chosen circle sees the location anyway', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(sheet());
    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(alert).not.toHaveBeenCalled();
    expect(mockTell).toHaveBeenCalledWith([home.id, club.id]);
    alert.mockRestore();
  });

  it('says a message waits for the connection, and stays honest about what could not be done', async () => {
    const onClose = jest.fn();
    await render(sheet(onClose));
    mockTell.mockResolvedValue({ status: 'waiting', sent: 0, waiting: 2, limited: 0 });
    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(toastNow()).toMatchObject({
      message: 'Bağlantı yok. Mesajın bağlantı gelince bir kez gidecek.',
      tone: 'info',
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // No place to tell: the sheet stays so it can be tried again.
    mockTell.mockResolvedValue({ status: 'noLocation', sent: 0, waiting: 0, limited: 0 });
    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(toastNow()).toMatchObject({
      tone: 'error',
      message: expect.stringContaining('Konumun alınamadı') as string,
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Too often: said, not hidden.
    mockTell.mockResolvedValue({ status: 'sent', sent: 0, waiting: 0, limited: 1 });
    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(toastNow()).toMatchObject({
      tone: 'error',
      message: expect.stringContaining('Çok sık') as string,
    });

    // Some went and some did not: said so, not "sent".
    mockTell.mockResolvedValue({ status: 'sent', sent: 1, waiting: 0, limited: 1 });
    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(toastNow()).toMatchObject({
      tone: 'error',
      message: expect.stringContaining('Bir kısmı gitti') as string,
    });

    // None went and none is limited (the server refused them): never "sent", and the sheet stays.
    onClose.mockClear();
    mockTell.mockResolvedValue({ status: 'sent', sent: 0, waiting: 0, limited: 0 });
    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(toastNow()).toMatchObject({ tone: 'error', message: 'Gönderilemedi. Tekrar dene.' });
    expect(onClose).not.toHaveBeenCalled();

    // A failure nobody expected.
    mockTell.mockRejectedValue(new Error('boom'));
    await fireEvent.press(screen.getByTestId('safe-send'));
    expect(toastNow()).toMatchObject({ tone: 'error', message: 'Gönderilemedi. Tekrar dene.' });
  });

  it('shows how many messages wait for the connection', async () => {
    await render(sheet());
    expect(screen.queryByTestId('safe-waiting')).toBeNull();
    await act(() => {
      useSafeWaiting.setState({ count: 3 });
    });
    expect(screen.getByTestId('safe-waiting').props.children).toBe(
      'Bağlantı gelince gidecek mesaj: 3',
    );
  });

  it('has nothing to send when there is no circle to tell, and none ticked', async () => {
    mockCircles = [];
    await render(sheet());
    expect(screen.getByTestId('safe-none')).toBeTruthy();
    expect(screen.getByTestId('safe-send').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('is in English for an English phone', async () => {
    await i18n.changeLanguage('en');
    const view = await render(sheet());
    expect(screen.getByText("I'm safe")).toBeTruthy();
    expect(screen.getByTestId('safe-send').props.accessibilityLabel).toBe("I'm safe, send (2)");
    // Back to Turkish for the rest, after the sheet is gone (nothing is drawn outside act).
    await view.unmount();
    await i18n.changeLanguage('tr');
  });
});

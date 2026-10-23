import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

jest.mock('@/ui/toast', () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
// The effects level: "full" unless a test turns it off.
const mockLevel: { current: 'full' | 'reduced' | 'off' } = { current: 'full' };
jest.mock('@/theme/effects', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/theme/effects'),
  useEffects: () => mockLevel.current,
}));
// The poke on screen is a plain store here; a reply is recorded.
const mockPokeWith = jest.fn<Promise<'sent'>, [string, string, string, string?]>(() =>
  Promise.resolve('sent'),
);
jest.mock('./poke', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    usePokeShow: create(() => null),
    pokeWith: (circleId: string, to: string, style: string, say?: string) =>
      mockPokeWith(circleId, to, style, say),
  };
});

import { usePokeShow } from './poke';
import { PokeOverlay } from './poke-overlay';

const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const AYSE = '0190f7a4-1111-7111-8111-0000000000a5';

function show(style: 'kiss' | 'angry' | 'where' | 'reply', say?: 'home') {
  usePokeShow.setState({ key: 1, circleId: CIRCLE, userId: AYSE, name: 'Ayşe', style, say }, true);
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockLevel.current = 'full';
  usePokeShow.setState(null, true);
});

describe('a poke on the screen of whom it is for (docs/ADR/0031)', () => {
  it('plays a kiss over the screen, saying who sent it', async () => {
    show('kiss');
    await render(<PokeOverlay />);
    expect(screen.getByTestId('poke-play-kiss')).toBeTruthy();
    expect(screen.getByText('Ayşe seni öptü 💋')).toBeTruthy();
  });

  it('with effects off, says it in a line and plays nothing', async () => {
    mockLevel.current = 'off';
    show('angry');
    await render(<PokeOverlay />);
    expect(screen.queryByTestId('poke-play-angry')).toBeNull();
    expect(toast.info).toHaveBeenCalledWith('Ayşe sana kızdı 😠');
    expect(usePokeShow.getState()).toBeNull();
  });

  it('asks a question with ready replies; one tap answers and closes it', async () => {
    show('where');
    await render(<PokeOverlay />);
    expect(screen.getByTestId('poke-question')).toBeTruthy();
    expect(screen.getByText('Ayşe: Nerdesin? 📍')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('poke-reply-onWay'));
    await waitFor(() => {
      expect(mockPokeWith).toHaveBeenCalledWith(CIRCLE, AYSE, 'reply', 'onWay');
    });
    expect(usePokeShow.getState()).toBeNull();
  });

  it('shows a reply for a moment', async () => {
    jest.useFakeTimers();
    show('reply', 'home');
    await render(<PokeOverlay />);
    expect(screen.getByText('Ayşe: Evdeyim')).toBeTruthy();
    await act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(usePokeShow.getState()).toBeNull();
    jest.useRealTimers();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

const mockStore = new Map<string, string>();
jest.mock('../storage/vault', () => ({
  isVaultOpen: () => true,
  vault: () => ({
    get: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => {
      mockStore.set(key, value);
    },
    delete: (key: string) => {
      mockStore.delete(key);
    },
  }),
}));
const mockCard = { showing: false };
jest.mock('../location/map-cards', () => ({ useCardShowing: () => mockCard.showing }));

import { useLocations } from '../location/receive';
import { EMPTY_MESSAGES, useMessages, withItem } from '../messages/messages';
import { TipBubble } from './tip-bubble';
import { markTipSeen, restoreTips, tipNow, tipsSeen, useTipsSeen } from './tips';

/** The vault as a store, to read it as the app does. */
const reader = () => ({
  get: (key: string) => mockStore.get(key),
  set: jest.fn(),
  delete: jest.fn(),
  keys: () => [...mockStore.keys()],
  clear: jest.fn(),
});

const ME = '0190f7a4-1111-7111-8111-000000000001';
const ADA = '0190f7a4-1111-7111-8111-000000000002';
const CIRCLE = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockStore.clear();
  mockCard.showing = false;
  useTipsSeen.setState({ seen: null });
  useLocations.setState({}, true);
  useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
});

describe('first-use tips (the PM report T6, 2026-10-29)', () => {
  it('come one at a time, in order, each when it means something here', () => {
    const here = { people: false, newStory: false, busy: false };
    expect(tipNow(null, here)).toBeNull();
    expect(tipNow([], here)).toBe('plus');
    expect(tipNow(['plus'], here)).toBeNull();
    expect(tipNow(['plus'], { ...here, people: true })).toBe('hold');
    expect(tipNow(['plus'], { ...here, newStory: true })).toBe('ring');
    expect(tipNow(['plus', 'hold', 'ring'], { people: true, newStory: true, busy: false })).toBe(
      null,
    );
    // A card asking something on the map goes first.
    expect(tipNow([], { ...here, busy: true })).toBeNull();
  });

  it('are each seen once, kept in the vault', () => {
    restoreTips();
    expect(useTipsSeen.getState().seen).toEqual([]);
    markTipSeen('plus');
    markTipSeen('plus');
    expect(useTipsSeen.getState().seen).toEqual(['plus']);
    expect(tipsSeen(reader())).toEqual(['plus']);
    // Anything else in the vault is not a tip.
    mockStore.set('tips:v1', '{not json');
    expect(tipsSeen(reader())).toEqual([]);
  });

  it('show above the dock, the + first, then the others as their moment comes', async () => {
    await render(<TipBubble me={ME} bottom={0} />);
    expect(screen.getByText('+ ile hızlı işler')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tip-ok'));
    expect(screen.queryByTestId('tip-plus')).toBeNull();
    expect(screen.queryByTestId('tip-hold')).toBeNull();

    // Someone shows up on the map: holding them is worth knowing.
    await act(() => {
      useLocations.setState({ [`${CIRCLE}:${ADA}`]: {} as never }, true);
    });
    expect(screen.getByText('Kişiye uzun bas')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tip-ok'));

    // Someone shares a story.
    await act(() => {
      useMessages.setState(
        withItem(useMessages.getState(), {
          id: '0190f7a4-3333-7333-8333-000000000001',
          conversation: `c:${CIRCLE}`,
          from: ADA,
          at: Date.now(),
          kind: 'photo',
          state: 'sent',
          photo: {
            blobId: 'file',
            key: 'k'.repeat(43),
            size: 1000,
            hash: 'h'.repeat(43),
            w: 10,
            h: 10,
            story: true,
          },
        }),
      );
    });
    expect(screen.getByText('Halka = yeni hikaye')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tip-ok'));
    expect(screen.queryByTestId('tip-ring')).toBeNull();
    expect(JSON.parse(mockStore.get('tips:v1') ?? '[]')).toEqual(['plus', 'hold', 'ring']);
  });

  it('waits while a card asks something on the map', async () => {
    mockCard.showing = true;
    await render(<TipBubble me={ME} bottom={0} />);
    expect(screen.queryByTestId('tip-plus')).toBeNull();
  });
});

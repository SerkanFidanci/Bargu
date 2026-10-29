import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { useStates } from '../location/why';
import { EMPTY_MESSAGES, useMessages, withItem } from '../messages/messages';
import { NO_MUTES, useMutes, withPersonMuted } from '../notifications/mutes';
import { PersonCard } from './person-card';
import type { PersonView } from './person-actions';

// Native modules jest does not have on Linux (CI), though Windows resolves them: the secure store,
// the notifications and the device lock.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(() => Promise.resolve({ type: 'fcm', data: '' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(0)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: false })),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// The card needs only two numbers from the people layer, not the map markers behind them.
jest.mock('./people-layer', () => ({ LOW_BATTERY: 15, staleMinutes: () => undefined }));
const mockClose = jest.fn();
jest.mock('./person-focus', () => ({
  ...jest.requireActual<typeof import('./person-focus')>('./person-focus'),
  closeCard: () => {
    mockClose();
  },
}));
// The mutes are read from the vault once it is open; here the store is set directly.
jest.mock('../storage/vault', () => ({ isVaultOpen: () => false }));
jest.mock('../notifications/extension-share', () => ({
  shareMutesWithExtension: () => Promise.resolve(),
}));

const ADA = '0190a8a0-0000-7000-8000-0000000000c1';
const person = (circleKind: PersonView['circleKind']): PersonView => ({
  userId: ADA,
  name: 'Ada',
  handle: '@ada',
  username: 'ada',
  avatar: null,
  location: null,
  circleId: circleKind === null ? null : '0190a8a0-0000-7000-8000-0000000000d1',
  circleKind,
});

async function renderCard(circleKind: PersonView['circleKind'] = 'pair', canMessage = true) {
  const onAction = jest.fn();
  await render(
    <PersonCard
      person={person(circleKind)}
      from={{ x: 0, y: 0 }}
      place={undefined}
      onAction={onAction}
      onHeight={jest.fn()}
      canMessage={canMessage}
    />,
  );
  return onAction;
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockClose.mockClear();
  useMutes.setState(NO_MUTES, true);
  useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
});

describe("a person's card (UX düzeni)", () => {
  it('closes with a visible ×, read out as "Kartı kapat"', async () => {
    await renderCard();
    await fireEvent.press(screen.getByLabelText('Kartı kapat'));
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('keeps three things up front and the rest under "Daha fazla" (PM report T3)', async () => {
    const onAction = await renderCard();
    expect(
      ['card-message', 'card-poke', 'card-directions', 'card-more'].map(
        (id) => screen.getByTestId(id).props.accessibilityLabel as string,
      ),
    ).toEqual(['Mesaj', 'Dürt', 'Yol tarifi', 'Daha fazla']);
    expect(screen.queryByTestId('card-history')).toBeNull();
    await fireEvent.press(screen.getByTestId('card-more'));
    expect(screen.getByTestId('card-more').props.accessibilityLabel).toBe('Daha az');
    expect(screen.getByText('Buluşma öner')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('card-history'));
    expect(onAction).toHaveBeenCalledWith('history');
    await fireEvent.press(screen.getByTestId('card-more'));
    expect(screen.queryByTestId('card-more-list')).toBeNull();
  });

  it('reports or blocks them from "Daha fazla", also someone met only at an event (QA-40 O2)', async () => {
    const onAction = await renderCard('group', false);
    await fireEvent.press(screen.getByTestId('card-more'));
    expect(screen.getByTestId('card-report').props.accessibilityLabel).toBe('Bildir');
    expect(screen.getByTestId('card-block').props.accessibilityLabel).toBe('Engelle');
    await fireEvent.press(screen.getByTestId('card-report'));
    expect(onAction).toHaveBeenCalledWith('report');
    await fireEvent.press(screen.getByTestId('card-block'));
    expect(onAction).toHaveBeenCalledWith('block');
  });

  it('opens their notifications from "Daha fazla", not only from a long press', async () => {
    const onAction = await renderCard();
    await fireEvent.press(screen.getByTestId('card-more'));
    await fireEvent.press(screen.getByTestId('card-notifications'));
    expect(onAction).toHaveBeenCalledWith('notifications');
  });

  it('opens their conversation from "Mesaj" (docs/ADR/0035)', async () => {
    const onAction = await renderCard();
    await fireEvent.press(screen.getByLabelText('Mesaj'));
    expect(onAction).toHaveBeenCalledWith('message');
  });

  it('has no "Mesaj" for someone met only at an event (QA-38 O2)', async () => {
    await renderCard('group', false);
    expect(screen.queryByTestId('card-message')).toBeNull();
  });

  it('says so when they are muted', async () => {
    useMutes.setState(withPersonMuted(NO_MUTES, ADA, { pokes: true }), true);
    await renderCard();
    expect(screen.getByText('@ada · Konumu şu an görünmüyor · Sessizde')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('card-more'));
    expect(screen.getByText('Ada: bildirimler sessizde')).toBeTruthy();
  });

  it('has no ring around their face without a story', async () => {
    await renderCard();
    expect(screen.queryByTestId('card-avatar-story')).toBeNull();
  });

  it('opens their story from the ring around their face (T6)', async () => {
    useMessages.setState(
      withItem(
        { ...EMPTY_MESSAGES, loaded: true },
        {
          id: '0190a8a0-0000-7000-8000-0000000000e1',
          conversation: 'c:0190a8a0-0000-7000-8000-0000000000d1',
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
        },
      ),
      true,
    );
    const onAction = await renderCard();
    expect(screen.getByTestId('card-avatar-story').props.accessibilityLabel).toBe(
      'Ada: hikayesini gör',
    );
    await fireEvent.press(screen.getByTestId('card-avatar-story'));
    expect(onAction).toHaveBeenCalledWith('story');
  });

  it('names the circle row after what it opens: a friendship', async () => {
    await renderCard('pair');
    await fireEvent.press(screen.getByTestId('card-more'));
    expect(screen.getByText('Arkadaşlık')).toBeTruthy();
  });

  it('names the circle row after what it opens: a circle', async () => {
    await renderCard('group');
    await fireEvent.press(screen.getByTestId('card-more'));
    expect(screen.getByText('Çember')).toBeTruthy();
  });
});

describe('why the location is old, on the card ("Neden eski?", docs/ADR/0028)', () => {
  const MINUTE = 60_000;
  const CIRCLE = '0190a8a0-0000-7000-8000-0000000000d1';
  const located = (minutesAgo: number): PersonView => ({
    ...person('pair'),
    location: {
      circleId: CIRCLE,
      userId: ADA,
      receivedAt: Date.now(),
      loc: {
        kind: 'loc',
        lat: 41.0256,
        lng: 28.9742,
        acc: 8,
        bat: 70,
        chg: false,
        ts: Date.now() - minutesAgo * MINUTE,
      },
    },
  });
  const said = (why: 'saver' | 'permission' | 'nofix' | 'none', minutesAgo: number, since = 0) => {
    useStates.setState(
      {
        [`${CIRCLE}:${ADA}`]: {
          circleId: CIRCLE,
          userId: ADA,
          why,
          since,
          ts: Date.now() - minutesAgo * MINUTE,
          receivedAt: Date.now(),
        },
      },
      true,
    );
  };
  const showCard = (view: PersonView) =>
    render(
      <PersonCard
        person={view}
        from={{ x: 0, y: 0 }}
        place={undefined}
        onAction={jest.fn()}
        onHeight={jest.fn()}
        canMessage
      />,
    );

  beforeEach(() => {
    useStates.setState({}, true);
  });

  it('gives the reason and since when, while their phone keeps renewing it', async () => {
    const since = new Date(2026, 9, 1, 14, 20).getTime();
    said('saver', 2, since);
    await showCard(located(40));
    expect(screen.getByTestId('card-why')).toBeTruthy();
    expect(screen.getByText("Pil tasarrufu · 14:20'den beri")).toBeTruthy();
  });

  it.each([
    ['permission', 'Konum izni kapalı'],
    ['nofix', 'Konum alınamıyor'],
  ] as const)('says %s as "%s"', async (why, text) => {
    said(why, 1, new Date(2026, 9, 1, 14, 30).getTime());
    await showCard(located(40));
    expect(screen.getByText(`${text} · 14:30'dan beri`)).toBeTruthy();
  });

  it('says "Çevrim dışı" with the time of the last message when nothing was said', async () => {
    const lastHeard = new Date(2026, 9, 1, 14, 20).getTime();
    const view = located(0);
    if (view.location === null) throw new Error('no location');
    await showCard({
      ...view,
      location: { ...view.location, loc: { ...view.location.loc, ts: lastHeard } },
    });
    expect(screen.getByText("Çevrim dışı · 14:20'den beri")).toBeTruthy();
  });

  it('a reason that was not renewed has lapsed into "Çevrim dışı"', async () => {
    said('saver', 15, new Date(2026, 9, 1, 14, 20).getTime());
    await showCard(located(40));
    expect(screen.queryByText(/Pil tasarrufu/)).toBeNull();
    expect(screen.getByText(/^Çevrim dışı · /)).toBeTruthy();
  });

  it('says nothing next to a fresh location, or right after they said it is over', async () => {
    said('saver', 1);
    const { unmount } = await showCard(located(2));
    expect(screen.queryByTestId('card-why')).toBeNull();
    await unmount();
    said('none', 1);
    await showCard(located(40));
    expect(screen.queryByTestId('card-why')).toBeNull();
  });

  it('is in English too', async () => {
    await i18n.changeLanguage('en');
    said('permission', 1, new Date(2026, 9, 1, 14, 20).getTime());
    const view = await showCard(located(40));
    try {
      expect(screen.getByText(/^Location permission off · since /)).toBeTruthy();
    } finally {
      // Off the screen first: a language change under a mounted screen is an update outside act().
      await view.unmount();
      await i18n.changeLanguage('tr');
    }
  });
});

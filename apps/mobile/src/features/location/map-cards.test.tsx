import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import i18n from '@/i18n';

import { NotificationCard } from '../notifications/notification-card';
import { usePushState } from '../notifications/push';
import { BackgroundLiveCard } from './background-live/card';
import { useCardSeen } from './background-live/notice-card';
import { LocationBanner } from './location-banner';
import { CardsWaiting } from './cards-waiting';
import { cardInFront, cardsWaiting, MAP_CARDS, type MapCard, useMapCardTurn } from './map-cards';
import { NewPhoneCard } from './new-phone-card';
import { DEFAULT_SHARING, useSharing, useSharingReview, withAdultDefaults } from './sharing';
import { SharingReminderCard } from './sharing-reminder-card';
import { useSharingReminder } from './sharing-reminder';
import { circleOf, memoryStore, somebody } from './test-support';
import { useLocationPermission } from './tracker';

const mockStore = memoryStore();
const mockMe = somebody();
const mockAda = somebody();
const mockCircles = [circleOf([mockMe, mockAda], { name: 'Aile' })];

// Native modules jest does not have on Linux (CI), though Windows resolves them.
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => true, vault: () => mockStore }));
jest.mock('../live/live-session', () => ({
  useConnection: (select: (state: { online: boolean; drops: number }) => unknown) =>
    select({ online: true, drops: 0 }),
}));
jest.mock('./tracker', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const useLocationPermission = create(() => ({ state: 'undetermined' }));
  return {
    useLocationPermission,
    useLocationServices: create(() => ({ state: 'on' })),
    // Allowing it answers the question.
    requestLocationPermission: jest.fn(() => {
      useLocationPermission.setState({ state: 'granted' });
      return Promise.resolve('granted');
    }),
  };
});
jest.mock('../notifications/push', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return { usePushState: create(() => ({ state: 'undetermined' })) };
});
jest.mock('../notifications/use-push', () => ({ askForPush: jest.fn(() => Promise.resolve()) }));
jest.mock('../auth/auth-store', () => ({
  useAuth: (select: (state: { userId: string }) => unknown) => select({ userId: mockMe.userId }),
}));
jest.mock('../circles/queries', () => ({ useCircles: () => ({ data: mockCircles }) }));
jest.mock('./location-session', () => {
  const sharing = jest.requireActual<typeof import('./sharing')>('./sharing');
  const reminder = jest.requireActual<typeof import('./sharing-reminder')>('./sharing-reminder');
  return {
    finishSharingReview: () => {
      sharing.useSharingReview.setState({ pending: false });
    },
    reviewSharing: () => {
      reminder.useSharingReminder.setState({ reviewedAt: Date.now() });
    },
    updateSharing: (
      change: (current: typeof sharing.DEFAULT_SHARING) => typeof sharing.DEFAULT_SHARING,
    ) => {
      sharing.useSharing.setState(change(sharing.useSharing.getState()), true);
    },
  };
});

/** Stands in for a card: shows its name when it is the one in front. */
function Stand({ card, wants }: { card: MapCard; wants: boolean }) {
  const turn = useMapCardTurn(card, wants);
  return turn ? <Text testID={card}>{card}</Text> : null;
}

const shown = () => MAP_CARDS.filter((card) => screen.queryByTestId(card) !== null);

describe('the cards on the map come one at a time (the PM, 2026-10-21)', () => {
  it('gives the screen to the first card, in a fixed order, that wants it', () => {
    expect(MAP_CARDS).toEqual([
      'locationPermission',
      'newPhone',
      'notificationPrompt',
      'sharingReminder',
      'backgroundLive',
      'invite',
    ]);
    const none = Object.fromEntries(MAP_CARDS.map((card) => [card, false])) as Record<
      MapCard,
      boolean
    >;
    expect(cardInFront(none)).toBeUndefined();
    expect(cardInFront({ ...none, backgroundLive: true })).toBe('backgroundLive');
    expect(cardInFront({ ...none, backgroundLive: true, newPhone: true })).toBe('newPhone');
    expect(cardInFront({ ...none, sharingReminder: true, locationPermission: true })).toBe(
      'locationPermission',
    );
    // "+N": how many wait behind the one in front (the PM report T4).
    expect(cardsWaiting(none)).toBe(0);
    expect(cardsWaiting({ ...none, newPhone: true })).toBe(0);
    expect(
      cardsWaiting({ ...none, newPhone: true, backgroundLive: true, sharingReminder: true }),
    ).toBe(2);
  });

  it('shows one of several that want it, and the next as soon as it is gone', async () => {
    const view = await render(
      <>
        <Stand card="backgroundLive" wants />
        <Stand card="notificationPrompt" wants />
        <Stand card="locationPermission" wants={false} />
      </>,
    );
    // Not in the order they were drawn: in the order of the queue.
    expect(shown()).toEqual(['notificationPrompt']);
    await view.rerender(
      <>
        <Stand card="backgroundLive" wants />
        <Stand card="notificationPrompt" wants={false} />
        <Stand card="locationPermission" wants={false} />
      </>,
    );
    expect(shown()).toEqual(['backgroundLive']);
    // One that comes late takes the front if it is ahead in the queue.
    await view.rerender(
      <>
        <Stand card="backgroundLive" wants />
        <Stand card="notificationPrompt" wants={false} />
        <Stand card="locationPermission" wants />
      </>,
    );
    expect(shown()).toEqual(['locationPermission']);
    // Taken off the screen, a card leaves the queue too.
    await view.rerender(<Stand card="backgroundLive" wants />);
    expect(shown()).toEqual(['backgroundLive']);
    await view.unmount();
    await render(<Stand card="newPhone" wants />);
    expect(shown()).toEqual(['newPhone']);
  });
});

describe('the real cards of the map never overlap', () => {
  const cards = (
    <>
      <LocationBanner />
      <NotificationCard />
      <NewPhoneCard onChoose={jest.fn()} />
      <SharingReminderCard />
      <BackgroundLiveCard />
      <CardsWaiting />
    </>
  );
  /** The test ids of the cards: the one question or explanation each puts on the screen. */
  const IDS = [
    'location-permission',
    'new-phone',
    'notification-prompt',
    'sharing-reminder',
    'background-live-card',
  ] as const;
  const visible = () => IDS.filter((id) => screen.queryByTestId(id) !== null);

  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });
  beforeEach(() => {
    mockStore.clear();
    useLocationPermission.setState({ state: 'undetermined' });
    usePushState.setState({ state: 'undetermined' });
    useSharingReview.setState({ pending: true });
    // The week since the last look is over and others see this phone's location.
    useSharingReminder.setState({ reviewedAt: 1 });
    // 18+ with the setting on, explanation not seen yet.
    useSharing.setState(withAdultDefaults(DEFAULT_SHARING), true);
    useCardSeen.setState({ seen: false });
  });

  it('with everything waiting for the screen, shows one at a time and goes down the queue', async () => {
    await render(cards);
    // 1. The permission question comes first; allowing it answers the location question.
    expect(visible()).toEqual(['location-permission']);
    // The rest wait, and say so under it (T4); notifications are asked only after this one.
    expect(screen.getByTestId('cards-waiting').props.accessibilityLabel).toBe('3 kart daha sırada');
    expect(screen.getByText('+3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('location-continue'));
    // 2. The choice after a reinstall.
    expect(visible()).toEqual(['new-phone']);
    await fireEvent.press(screen.getByTestId('share-all'));
    // 3. Notifications are asked for once the location question has an answer.
    expect(visible()).toEqual(['notification-prompt']);
    await fireEvent.press(screen.getByTestId('notification-later'));
    // 4. The weekly reminder.
    expect(visible()).toEqual(['sharing-reminder']);
    await fireEvent.press(screen.getByTestId('sharing-reminder-ok'));
    // 5. Last, the explanation of background live mode.
    expect(visible()).toEqual(['background-live-card']);
    await fireEvent.press(screen.getByTestId('background-live-card-ok'));
    expect(visible()).toEqual([]);
    expect(screen.queryByTestId('cards-waiting')).toBeNull();
  });

  it('goes on down the queue when the permission question is put off ("Şimdi değil")', async () => {
    await render(cards);
    expect(visible()).toEqual(['location-permission']);
    await fireEvent.press(screen.getByTestId('location-later'));
    // Notifications wait for the location question to be answered; the others do not.
    expect(visible()).toEqual(['new-phone']);
    await fireEvent.press(screen.getByTestId('choose-circles'));
    expect(visible()).toEqual(['sharing-reminder']);
    await fireEvent.press(screen.getByTestId('sharing-reminder-edit'));
    expect(visible()).toEqual(['background-live-card']);
    // "Ayarlar" closes the card too, and counts as having seen it.
    await fireEvent.press(screen.getByTestId('background-live-card-settings'));
    expect(visible()).toEqual([]);
  });

  it('keeps the explanation of background live mode off the screen while another card is there', async () => {
    useSharingReview.setState({ pending: false });
    useLocationPermission.setState({ state: 'blocked' });
    await render(cards);
    // The blocked-permission card (it points to the settings) is in front of everything.
    expect(visible()).toEqual(['location-permission']);
    await act(() => {
      useLocationPermission.setState({ state: 'granted' });
    });
    expect(visible()).toEqual(['notification-prompt']);
  });

  it('shows the explanation at once when nothing else is asking', async () => {
    useSharingReview.setState({ pending: false });
    useSharingReminder.setState({ reviewedAt: Date.now() });
    useLocationPermission.setState({ state: 'granted' });
    usePushState.setState({ state: 'enabled' });
    await render(cards);
    expect(visible()).toEqual(['background-live-card']);
  });
});

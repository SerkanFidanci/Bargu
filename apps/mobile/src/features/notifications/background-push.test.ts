import {
  generateDeviceKeys,
  randomUuid,
  sealForDevice,
  sealPush,
  toBase64url,
} from '@bargu/crypto';
import type { PushBody } from '@bargu/schemas';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { backgroundLive } from '../location/background-live/slot';
import { memoryStore } from '../location/test-support';
import { rememberSafe, SAFE_AHEAD_MS, SAFE_FRESH_MS } from '../social/safe';
import {
  loadSpots,
  openSpot,
  resetSpot,
  SPOT_KEEP_MS,
  spotOf,
  spotShape,
  useSafeSpot,
} from '../social/safe-spot';
import { PUSH_FRESH_MS, showPush, WATCH_FRESH_MS } from './background-push';
import { saveMutes } from './mutes';
import { safeOfResponse } from './push';
import { type PushContacts, saveContacts } from './push-contacts';

const mockDevice = generateDeviceKeys(randomUuid());
const mockStore = memoryStore();

// Native modules jest does not have on Linux (CI), though Windows resolves them.
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  registerTaskAsync: jest.fn(() => Promise.resolve()),
  // push.ts (which reads what a tapped notification names) sets the foreground handler on load.
  setNotificationHandler: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('@/ui/toast', () => ({ toast: { info: jest.fn(), notice: jest.fn() } }));
jest.mock('../auth/auth-store', () => ({
  useAuth: { getState: () => ({ device: mockDevice }) },
}));
jest.mock('../live/live-session', () => ({ ensureSession: () => Promise.resolve(true) }));
jest.mock('../storage/vault', () => ({ vault: () => mockStore }));

const circleId = randomUuid();
const NOW = 1_800_000_000_000;
const recipient = { deviceId: mockDevice.deviceId, dhKey: mockDevice.dh.publicKey };
const notice = (kind: string, ts = NOW) => ({ kind: 'notice', notice: kind, circleId, ts });

/** A box the server sealed for this phone. */
const fromServer = (body: PushBody) => sealPush({ recipient, sender: null, body });

/**
 * A box with a body this app's schema does not know, the way a newer server would send one to an
 * older app (sealPush itself refuses to seal it).
 */
function fromNewerServer(body: unknown): string {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const inner = new Uint8Array(json.length + 1);
  inner.set(json, 1);
  return sealForDevice(mockDevice.dh.publicKey, inner);
}

/** The background task as the bundle defined it on load (before any mock is cleared). */
const pushTask = jest.mocked(TaskManager.defineTask).mock.calls[0]?.[1];

const scheduled = Notifications.scheduleNotificationAsync as jest.Mock;
const toasted = toast.info as jest.Mock;
const toastNotice = toast.notice as jest.Mock;
const mockNotice = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

function appIs(state: 'active' | 'background') {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  backgroundLive.current = { notice: (id) => mockNotice(id) };
  backgroundLive.loading = null;
  appIs('background');
});
afterEach(() => {
  backgroundLive.current = null;
});

describe('a notice this app does not know is dropped silently', () => {
  it('shows nothing, whether the app is closed or open, and does not touch background live mode', async () => {
    for (const state of ['background', 'active'] as const) {
      appIs(state);
      const sealed = fromNewerServer(notice('someFutureNews'));
      expect(await showPush(sealed, NOW)).toBe('refused');
    }
    // A whole new kind of notification, too.
    expect(await showPush(fromNewerServer({ kind: 'hologram', circleId, ts: NOW }), NOW)).toBe(
      'refused',
    );
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
    expect(mockNotice).not.toHaveBeenCalled();
  });
});

describe('server notices the server signed (QA-28 B-1, before the phone checks them)', () => {
  // A throwaway notice key: 32 random bytes.
  const signer = { secretKey: generateDeviceKeys(randomUuid()).identity.secretKey, kid: 'stg-n1' };
  const signed = (body: PushBody) => sealPush({ recipient, sender: null, body, signer });

  it('open and act exactly like unsigned ones: this build checks nothing yet', async () => {
    expect(
      await showPush(signed({ kind: 'notice', notice: 'watch', circleId, ts: NOW }), NOW),
    ).toBe('watch');
    expect(mockNotice).toHaveBeenCalledWith(circleId);
    expect(
      await showPush(signed({ kind: 'notice', notice: 'circleInvite', circleId, ts: NOW }), NOW),
    ).toBe('shown');
    // Unsigned ones too, as a server without a notice key sends them.
    expect(
      await showPush(
        fromServer({ kind: 'notice', notice: 'friendRequest', circleId, ts: NOW }),
        NOW,
      ),
    ).toBe('shown');
    expect(scheduled).toHaveBeenCalledTimes(2);
  });

  it('a box in a format the app does not know is dropped without a word, as an older app (028ab2e) drops a signed notice', async () => {
    // The opening code of 028ab2e refuses the signed notice's first byte (0x02) the way today's
    // refuses 0x03 (packages/crypto legacy-app.spec.ts runs that code); this file, which handles
    // the refusal, is unchanged since 028ab2e.
    const unknown = sealForDevice(
      mockDevice.dh.publicKey,
      Uint8Array.of(3, ...new TextEncoder().encode(JSON.stringify(notice('watch')))),
    );
    for (const state of ['background', 'active'] as const) {
      appIs(state);
      expect(await showPush(unknown, NOW)).toBe('refused');
    }
    // The background task, as Android runs it, ends quietly too.
    expect(pushTask).toBeDefined();
    await expect(
      pushTask?.({
        data: { bargu: unknown },
        error: null,
        executionInfo: { eventId: 'event', taskName: 'bargu-push' },
      }),
    ).resolves.toBeUndefined();
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
    expect(mockNotice).not.toHaveBeenCalled();
  });
});

describe('the watch notice of background live mode (docs/ADR/0028 step 3)', () => {
  const watch = (ts = NOW) => fromServer({ kind: 'notice', notice: 'watch', circleId, ts });

  it('is never shown: no notification in the background, no line in the open app', async () => {
    expect(await showPush(watch(), NOW)).toBe('watch');
    appIs('active');
    expect(await showPush(watch(), NOW)).toBe('watch');
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
  });

  it('goes to background live mode with the circle it names, nothing else', async () => {
    await showPush(watch(), NOW);
    expect(mockNotice).toHaveBeenCalledTimes(1);
    expect(mockNotice).toHaveBeenCalledWith(circleId);
  });

  it('waits for the feature to load when the app was started by the notice', async () => {
    backgroundLive.current = null;
    let loaded = false;
    backgroundLive.loading = Promise.resolve().then(() => {
      backgroundLive.current = {
        notice: (id) => {
          loaded = true;
          return mockNotice(id);
        },
      };
    });
    await showPush(watch(), NOW);
    expect(loaded).toBe(true);
  });

  it('is dropped without a trace in a build that does not have the feature (production)', async () => {
    backgroundLive.current = null;
    expect(await showPush(watch(), NOW)).toBe('watch');
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
  });

  it('is old after two minutes, and a message delivered twice counts once', async () => {
    expect(WATCH_FRESH_MS).toBe(2 * 60_000);
    expect(await showPush(watch(NOW - WATCH_FRESH_MS - 1), NOW)).toBe('stale');
    expect(mockNotice).not.toHaveBeenCalled();
    const once = watch();
    expect(await showPush(once, NOW)).toBe('watch');
    expect(await showPush(once, NOW)).toBe('duplicate');
    expect(mockNotice).toHaveBeenCalledTimes(1);
  });

  it('leaves the freshness of every other notification as it was (an hour)', async () => {
    const invite = fromServer({
      kind: 'notice',
      notice: 'circleInvite',
      circleId,
      ts: NOW - 10 * 60_000,
    });
    expect(await showPush(invite, NOW)).toBe('shown');
    expect(scheduled).toHaveBeenCalledTimes(1);
    const old = fromServer({
      kind: 'notice',
      notice: 'circleInvite',
      circleId,
      ts: NOW - PUSH_FRESH_MS - 1,
    });
    expect(await showPush(old, NOW)).toBe('stale');
  });
});

describe('Güvendeyim from a member (docs/ADR/0029)', () => {
  const ayse = generateDeviceKeys(randomUuid());
  const ayseUserId = randomUuid();
  const contacts: PushContacts = {
    devices: {
      [ayse.deviceId]: {
        userId: ayseUserId,
        name: 'Ayşe',
        identityKey: toBase64url(ayse.identity.publicKey),
      },
    },
    circles: { [circleId]: { name: 'Aile' } },
    recipients: {},
  };
  const messageId = 'AAAAAAAAAAAAAAAAAAAAAA';
  const safe = (overrides: Partial<Extract<PushBody, { kind: 'safe' }>> = {}): PushBody => ({
    kind: 'safe',
    circleId,
    id: messageId,
    bat: 45,
    ts: NOW,
    ...overrides,
  });
  /** A box Ayşe's phone sealed for this phone. */
  const fromAyse = (body: PushBody) => sealPush({ recipient, sender: ayse, body });

  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });
  beforeEach(() => {
    saveContacts(mockStore, contacts);
  });

  it('is worded by this phone from who it trusts: the name, that she is safe, the battery', async () => {
    const sealed = fromAyse(safe());
    expect(await showPush(sealed, NOW + 60_000)).toBe('shown');
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledWith({
      content: { title: 'Aile', body: 'Ayşe: İyiyim ✓ · %45', data: { circleId } },
      trigger: { channelId: 'social' },
    });
    // The text is on this phone only: the box says no name and no words.
    expect(sealed).not.toMatch(/Ayşe|iyiyim/i);
  });

  it('is a line in the open app instead of a banner', async () => {
    appIs('active');
    expect(await showPush(fromAyse(safe()), NOW + 60_000)).toBe('inApp');
    expect(toasted).toHaveBeenCalledWith('Ayşe: İyiyim ✓ · %45');
    expect(scheduled).not.toHaveBeenCalled();
  });

  it('is not muted with the pokes of the same person: a safety message is not to be missed', async () => {
    saveMutes(mockStore, {
      people: { [ayseUserId]: { places: true, pokes: true } },
      places: {},
    });
    expect(await showPush(fromAyse({ kind: 'bump', circleId, ts: NOW }), NOW)).toBe('muted');
    expect(await showPush(fromAyse(safe()), NOW)).toBe('shown');
  });

  it('is shown once, by its id, in whatever box: the message itself may have come first', async () => {
    expect(await showPush(fromAyse(safe()), NOW)).toBe('shown');
    // A second box of the same message (another ephemeral key, so not the same box).
    expect(await showPush(fromAyse(safe()), NOW)).toBe('duplicate');
    // The open app showed the message first: the notification stays quiet.
    const other = 'AAAAAAAAAAAAAAAAAAAAAQ';
    expect(rememberSafe(mockStore, circleId, ayseUserId, other)).toBe(true);
    expect(await showPush(fromAyse(safe({ id: other })), NOW)).toBe('duplicate');
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it('is the same message only from the same sender in the same circle: another member cannot use up its id (QA-32 F-2)', async () => {
    const carol = generateDeviceKeys(randomUuid());
    const carolUserId = randomUuid();
    saveContacts(mockStore, {
      ...contacts,
      devices: {
        ...contacts.devices,
        [carol.deviceId]: {
          userId: carolUserId,
          name: 'Cem',
          identityKey: toBase64url(carol.identity.publicKey),
        },
      },
    });
    // Cem sends the id first...
    expect(await showPush(sealPush({ recipient, sender: carol, body: safe() }), NOW)).toBe('shown');
    // ...Ayşe's own message with that id is still hers: shown. A repeat of either is not.
    expect(await showPush(fromAyse(safe()), NOW)).toBe('shown');
    expect(await showPush(fromAyse(safe()), NOW)).toBe('duplicate');
    expect(await showPush(sealPush({ recipient, sender: carol, body: safe() }), NOW)).toBe(
      'duplicate',
    );
    // The same sender and id in another circle of theirs is another message.
    const other = randomUuid();
    expect(await showPush(fromAyse(safe({ circleId: other })), NOW)).toBe('shown');
    expect(scheduled).toHaveBeenCalledTimes(3);
  });

  it('is still news after hours (it waited for her connection), with the time, and old after a day', async () => {
    const waited = fromAyse(safe({ ts: NOW - 3 * 60 * 60_000 }));
    expect(await showPush(waited, NOW)).toBe('shown');
    expect(scheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          body: expect.stringMatching(/^Ayşe: İyiyim ✓ · %45 · \d{2}[:.]\d{2}$/) as string,
        }) as unknown,
      }),
    );
    const old = fromAyse(safe({ id: 'AAAAAAAAAAAAAAAAAAAAAQ', ts: NOW - SAFE_FRESH_MS - 1 }));
    expect(await showPush(old, NOW)).toBe('stale');
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it('is taken when dated up to five minutes ahead and dropped, unseen, when dated further', async () => {
    const ahead = (ts: number, id: string) => fromAyse(safe({ ts, id }));
    expect(SAFE_AHEAD_MS).toBe(5 * 60_000);
    // To the millisecond.
    expect(await showPush(ahead(NOW + SAFE_AHEAD_MS, 'AAAAAAAAAAAAAAAAAAAAAA'), NOW)).toBe('shown');
    expect(await showPush(ahead(NOW + SAFE_AHEAD_MS + 1, 'AAAAAAAAAAAAAAAAAAAAAQ'), NOW)).toBe(
      'future',
    );
    expect(await showPush(ahead(NOW + 24 * 60 * 60_000, 'AAAAAAAAAAAAAAAAAAAAAg'), NOW)).toBe(
      'future',
    );
    expect(scheduled).toHaveBeenCalledTimes(1);
    appIs('active');
    expect(await showPush(ahead(NOW + SAFE_AHEAD_MS + 1, 'AAAAAAAAAAAAAAAAAAAAAw'), NOW)).toBe(
      'future',
    );
    expect(toasted).not.toHaveBeenCalled();
    expect(toastNotice).not.toHaveBeenCalled();
    // A message dropped as ahead is not remembered: the same id, dated right, is shown.
    appIs('background');
    expect(await showPush(ahead(NOW, 'AAAAAAAAAAAAAAAAAAAAAQ'), NOW)).toBe('shown');
    // A day behind to the millisecond is still news, a millisecond more is not (as before).
    expect(await showPush(ahead(NOW - SAFE_FRESH_MS, 'AAAAAAAAAAAAAAAAAAAAAw'), NOW)).toBe('shown');
    expect(await showPush(ahead(NOW - SAFE_FRESH_MS - 1, 'AAAAAAAAAAAAAAAAAAAABA'), NOW)).toBe(
      'stale',
    );
  });

  it('is dropped without a word from a device this phone does not trust', async () => {
    const stranger = generateDeviceKeys(randomUuid());
    const forged = sealPush({ recipient, sender: stranger, body: safe() });
    for (const state of ['background', 'active'] as const) {
      appIs(state);
      expect(await showPush(forged, NOW)).toBe('refused');
    }
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
  });

  describe('with the place in the notification (docs/ADR/0029 §5)', () => {
    const exact = { lat: 41.025_612_345, lng: 28.974_212_345, acc: 8 };
    const tapped = (data: unknown) =>
      ({ notification: { request: { content: { data } } } }) as unknown as Parameters<
        typeof safeOfResponse
      >[0];
    /** What the system shows when the notification is tapped: the data the app scheduled it with. */
    const dataOf = () => {
      const call = scheduled.mock.calls[0] as [{ content: { data: unknown } }] | undefined;
      return call?.[0].content.data;
    };

    beforeEach(() => {
      resetSpot();
    });

    it('keeps the place on the phone, for a day, in the vault and nowhere else', async () => {
      expect(await showPush(fromAyse(safe(exact)), NOW + 60_000)).toBe('shown');
      const spot = spotOf(mockStore, messageId, NOW + 60_000);
      expect(spot).toEqual({
        id: messageId,
        circleId,
        name: 'Ayşe',
        ...exact,
        bat: 45,
        ts: NOW,
      });
      // A day after the message was made it is deleted from the vault, not only left unshown.
      expect(loadSpots(mockStore, NOW + SPOT_KEEP_MS + 1)).toEqual([]);
      expect(mockStore.keys().filter((key) => key.startsWith('safe:spots'))).toEqual([]);
    });

    it('names the message in the notification, never the place', async () => {
      await showPush(fromAyse(safe(exact)), NOW + 60_000);
      expect(dataOf()).toEqual({ circleId, safe: messageId });
      // Nothing the system keeps of the notification has a coordinate in it.
      expect(JSON.stringify(scheduled.mock.calls)).not.toMatch(/41\.02|28\.97/);
    });

    it('opens the map at that point when tapped: a dot for an exact place', async () => {
      await showPush(fromAyse(safe(exact)), NOW + 60_000);
      const id = safeOfResponse(tapped(dataOf()));
      expect(id).toBe(messageId);
      expect(openSpot(mockStore, id ?? '', NOW + 2 * 60_000)).toBe(true);
      const shown = useSafeSpot.getState().spot;
      expect(shown).toMatchObject(exact);
      expect(spotShape(shown?.acc ?? 0)).toBe('dot');
    });

    it('opens the map at that point when tapped: a circle with its accuracy for a coarse place', async () => {
      const coarse = { lat: 41.0, lng: 29.0, acc: 708 };
      await showPush(fromAyse(safe({ ...coarse, id: 'AAAAAAAAAAAAAAAAAAAAAQ' })), NOW);
      const id = safeOfResponse(tapped(dataOf()));
      expect(openSpot(mockStore, id ?? '', NOW)).toBe(true);
      const shown = useSafeSpot.getState().spot;
      expect(shown).toMatchObject(coarse);
      expect(spotShape(shown?.acc ?? 0)).toBe('circle');
    });

    it('opens the circle instead when the place is gone (a day old) or the data names no message', async () => {
      await showPush(fromAyse(safe(exact)), NOW);
      expect(openSpot(mockStore, messageId, NOW + SPOT_KEEP_MS + 1)).toBe(false);
      expect(safeOfResponse(tapped({ circleId }))).toBeNull();
      expect(safeOfResponse(tapped({ circleId, safe: 'not an id' }))).toBeNull();
      expect(safeOfResponse(tapped(null))).toBeNull();
      expect(safeOfResponse(tapped('x'))).toBeNull();
    });

    it('is a line in the open app whose tap shows the place', async () => {
      appIs('active');
      expect(await showPush(fromAyse(safe(exact)), NOW + 60_000)).toBe('inApp');
      expect(toastNotice).toHaveBeenCalledWith(
        'Ayşe: İyiyim ✓ · %45',
        'success',
        expect.any(Function),
      );
      const call = toastNotice.mock.calls[0] as [string, string, () => void] | undefined;
      call?.[2]();
      expect(useSafeSpot.getState().spot).toMatchObject(exact);
    });

    it('keeps its place once, whichever of the message and the notification comes first, and still is never muted', async () => {
      saveMutes(mockStore, {
        people: { [ayseUserId]: { places: true, pokes: true } },
        places: {},
      });
      expect(await showPush(fromAyse(safe(exact)), NOW)).toBe('shown');
      expect(await showPush(fromAyse(safe(exact)), NOW)).toBe('duplicate');
      expect(loadSpots(mockStore, NOW)).toHaveLength(1);
    });

    it('keeps no place when the notification has none (a phone from before)', async () => {
      expect(await showPush(fromAyse(safe()), NOW)).toBe('shown');
      expect(loadSpots(mockStore, NOW)).toEqual([]);
      expect(dataOf()).toEqual({ circleId });
    });
  });
});

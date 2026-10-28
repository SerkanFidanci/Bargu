import {
  generateDeviceKeys,
  noticePublicKey,
  openSealed,
  parseNoticeKeys,
  randomUuid,
  sealForDevice,
  sealPush,
  toBase64url,
} from '@bargu/crypto';
import { PUSH_NOTICES, type PushBody } from '@bargu/schemas';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { backgroundLive } from '../location/background-live/slot';
import { memoryStore } from '../location/test-support';
import { admitSafe, rememberSafe, SAFE_AHEAD_MS, SAFE_FRESH_MS } from '../social/safe';
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
import { SAFE_QUIET_CHANNEL } from './channels';
import { saveBlocked } from '../messages/blocked';
import { saveMutes } from './mutes';
import { safeOfResponse } from './push';
import { EMPTY_CONTACTS, type PushContacts, saveContacts } from './push-contacts';

const mockDevice = generateDeviceKeys(randomUuid());
const mockStore = memoryStore();
// The server's notice key (QA-28 B-1): a throwaway one, 32 random bytes; the build trusts its
// public half, as a preview build trusts staging's (EXPO_PUBLIC_NOTICE_KEYS).
const signer = { secretKey: generateDeviceKeys(randomUuid()).identity.secretKey, kid: 'test-n1' };
let mockNoticeKeys = parseNoticeKeys(`test-n1:${noticePublicKey(signer.secretKey)}`);

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
// A poke with a feeling plays in the open app (docs/ADR/0031): not what is tested here.
jest.mock('../social/poke', () => ({ pokeFromTap: jest.fn() }));
jest.mock('../storage/vault', () => ({ vault: () => mockStore }));
jest.mock('./notice-keys', () => ({
  get trustedNoticeKeys() {
    return mockNoticeKeys;
  },
  sharedNoticeKeys: () => ({}),
}));

const circleId = randomUuid();
const NOW = 1_800_000_000_000;
const recipient = { deviceId: mockDevice.deviceId, dhKey: mockDevice.dh.publicKey };
const notice = (kind: string, ts = NOW) => ({ kind: 'notice', notice: kind, circleId, ts });

/** A box the server sealed for this phone, signed with its notice key. */
const fromServer = (body: PushBody) => sealPush({ recipient, sender: null, body, signer });

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

describe('server notices are the server’s only when it signed them (QA-28 B-1)', () => {
  const body = (kind: (typeof PUSH_NOTICES)[number], ts = NOW): PushBody => ({
    kind: 'notice',
    notice: kind,
    circleId,
    ts,
  });
  /** What any member of the circle can seal: they know this device's DH key. */
  const unsigned = (kind: (typeof PUSH_NOTICES)[number]) =>
    sealPush({ recipient, sender: null, body: body(kind) });
  /** A genuine notice sealed for another device, opened there and sealed again for this one. */
  function resealed(kind: (typeof PUSH_NOTICES)[number]): string {
    const other = generateDeviceKeys(randomUuid());
    const box = sealPush({
      recipient: { deviceId: other.deviceId, dhKey: other.dh.publicKey },
      sender: null,
      body: body(kind),
      signer,
    });
    return sealForDevice(mockDevice.dh.publicKey, openSealed(other, box));
  }
  const nothingHappened = () => {
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
    expect(mockNotice).not.toHaveBeenCalled();
  };

  afterEach(() => {
    mockNoticeKeys = parseNoticeKeys(`test-n1:${noticePublicKey(signer.secretKey)}`);
  });

  it('takes a signed notice as before: a banner, or the silent watch', async () => {
    expect(await showPush(fromServer(body('circleInvite')), NOW)).toBe('shown');
    expect(await showPush(fromServer(body('watch')), NOW)).toBe('watch');
    expect(mockNotice).toHaveBeenCalledWith(circleId);
  });

  it.each(PUSH_NOTICES)(
    'drops an unsigned or re-sealed %s without a word, open or closed',
    async (kind) => {
      for (const state of ['background', 'active'] as const) {
        appIs(state);
        expect(await showPush(unsigned(kind), NOW)).toBe('refused');
        expect(await showPush(resealed(kind), NOW)).toBe('refused');
      }
      nothingHappened();
    },
  );

  it('the QA reproduction: a member’s watch notice does not open background live mode', async () => {
    // Unsigned, signed by another key under the trusted kid, under an unknown kid, or re-sealed.
    const forged = [
      unsigned('watch'),
      sealPush({
        recipient,
        sender: null,
        body: body('watch'),
        signer: { ...signer, secretKey: generateDeviceKeys(randomUuid()).identity.secretKey },
      }),
      sealPush({ recipient, sender: null, body: body('watch'), signer: { ...signer, kid: 'x-1' } }),
      resealed('watch'),
    ];
    for (const sealed of forged) expect(await showPush(sealed, NOW)).toBe('refused');
    nothingHappened();
    // The server's own watch still does.
    expect(await showPush(fromServer(body('watch')), NOW)).toBe('watch');
    expect(mockNotice).toHaveBeenCalledTimes(1);
  });

  it('takes a notice once: the same box is a duplicate, its content sealed again a replay', async () => {
    const box = fromServer(body('watch'));
    expect(await showPush(box, NOW)).toBe('watch');
    expect(await showPush(box, NOW)).toBe('duplicate');
    const again = sealForDevice(mockDevice.dh.publicKey, openSealed(mockDevice, box));
    expect(await showPush(again, NOW + 1_000)).toBe('refused');
    expect(mockNotice).toHaveBeenCalledTimes(1);
  });

  it('drops a stale signed notice: a watch after two minutes, the others after an hour', async () => {
    expect(await showPush(fromServer(body('watch', NOW - WATCH_FRESH_MS - 1)), NOW)).toBe('stale');
    expect(await showPush(fromServer(body('memberJoined', NOW - PUSH_FRESH_MS - 1)), NOW)).toBe(
      'stale',
    );
    nothingHappened();
  });

  it.each(['watch', 'circleInvite'] as const)(
    'takes a %s dated up to 5 minutes ahead of the phone, drops one further ahead',
    async (kind) => {
      const ahead = 5 * 60_000;
      expect(await showPush(fromServer(body(kind, NOW + ahead)), NOW)).toBe(
        kind === 'watch' ? 'watch' : 'shown',
      );
      expect(await showPush(fromServer(body(kind, NOW + ahead + 1)), NOW)).toBe('refused');
      expect(await showPush(fromServer(body(kind, NOW + 60 * 60_000)), NOW)).toBe('refused');
      expect(mockNotice).toHaveBeenCalledTimes(kind === 'watch' ? 1 : 0);
    },
  );

  it.each(['watch', 'circleInvite'] as const)(
    'ages a %s dated 4 minutes ahead from its own date: taken until then plus its window (QA-30 L-1)',
    async (kind) => {
      const window = kind === 'watch' ? WATCH_FRESH_MS : PUSH_FRESH_MS;
      const taken = kind === 'watch' ? 'watch' : 'shown';
      const issuedAt = NOW + 4 * 60_000;
      // Each box is a new notice (new id): what matters is only when it arrives.
      expect(await showPush(fromServer(body(kind, issuedAt)), NOW)).toBe(taken);
      expect(await showPush(fromServer(body(kind, issuedAt)), issuedAt + window)).toBe(taken);
      expect(await showPush(fromServer(body(kind, issuedAt)), issuedAt + window + 1)).toBe('stale');
      // 6 minutes ahead: dropped.
      expect(await showPush(fromServer(body(kind, NOW + 6 * 60_000)), NOW)).toBe('refused');
    },
  );

  it('takes no notice at all in a build that trusts no notice key', async () => {
    mockNoticeKeys = new Map();
    expect(await showPush(fromServer(body('circleInvite')), NOW)).toBe('refused');
    expect(await showPush(fromServer(body('watch')), NOW)).toBe('refused');
    nothingHappened();
  });

  it('keeps taking members’ notifications, which their own phones sign, without any notice key', async () => {
    mockNoticeKeys = new Map();
    const ada = generateDeviceKeys(randomUuid());
    saveContacts(mockStore, {
      ...EMPTY_CONTACTS,
      devices: {
        [ada.deviceId]: {
          userId: randomUuid(),
          name: 'Ada',
          identityKey: toBase64url(ada.identity.publicKey),
        },
      },
    });
    const poke = sealPush({ recipient, sender: ada, body: { kind: 'bump', circleId, ts: NOW } });
    expect(await showPush(poke, NOW)).toBe('shown');
  });

  it('a box in a format the app does not know is dropped without a word, as an older app (028ab2e) drops a signed notice', async () => {
    // The opening code of 028ab2e refuses the signed notice's first byte (0x02) the way today's
    // refuses 0x03 (packages/crypto legacy-app.spec.ts runs that code), through the same catch.
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
    nothingHappened();
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

  it('of messages is one per conversation, and none at all from someone blocked (QA-38 O1)', async () => {
    const chat: PushBody = { kind: 'chat', circleId, photo: false, ts: NOW };
    expect(await showPush(fromAyse(chat), NOW)).toBe('shown');
    expect(scheduled).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: `chat:c:${circleId}` }),
    );
    saveBlocked(mockStore, [ayseUserId]);
    expect(await showPush(fromAyse(chat), NOW)).toBe('muted');
    expect(await showPush(fromAyse({ kind: 'moment', circleId, ts: NOW }), NOW)).toBe('muted');
    expect(await showPush(fromAyse({ kind: 'shot', ts: NOW }), NOW)).toBe('muted');
    // Her "I'm safe" is not a message: it still shows.
    expect(await showPush(fromAyse(safe()), NOW)).toBe('shown');
    saveBlocked(mockStore, []);
  });

  it('of a muted circle are silent, while her other conversations are not (QA-39)', async () => {
    saveMutes(mockStore, { people: {}, places: {}, circles: { [circleId]: true } });
    const chat: PushBody = { kind: 'chat', circleId, photo: false, ts: NOW };
    expect(await showPush(fromAyse(chat), NOW)).toBe('muted');
    expect(await showPush(fromAyse({ kind: 'moment', circleId, ts: NOW }), NOW)).toBe('muted');
    // Written to alone, not in the circle: still heard. So is her "I'm safe".
    expect(await showPush(fromAyse({ kind: 'chat', photo: false, ts: NOW }), NOW)).toBe('shown');
    expect(await showPush(fromAyse(safe()), NOW)).toBe('shown');
    saveMutes(mockStore, { people: {}, places: {} });
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

  describe('past six an hour from one person in one circle (QA-32 F-1)', () => {
    /** Ten distinct messages: the id's last character is one of the four a canonical id may end in. */
    const idOf = (n: number) => `${'A'.repeat(19)}${String(n).padStart(2, '0')}A`;
    const at = (n: number) => NOW + n * 1_000;
    /** A message with a place, to see which places are kept. */
    const placed = (n: number) => safe({ id: idOf(n), lat: 41, lng: 29, acc: 8 });

    it('shows six, then sums the rest up in one quiet notification that is renewed, with no sound and no vibration', async () => {
      for (let n = 0; n < 6; n += 1) {
        expect(await showPush(fromAyse(placed(n)), at(n))).toBe('shown');
      }
      expect(scheduled).toHaveBeenCalledTimes(6);

      expect(await showPush(fromAyse(placed(6)), at(6))).toBe('folded');
      expect(await showPush(fromAyse(placed(7)), at(7))).toBe('folded');
      expect(scheduled).toHaveBeenCalledTimes(8);
      const first = scheduled.mock.calls[6] as [Record<string, unknown>];
      const second = scheduled.mock.calls[7] as [Record<string, unknown>];
      // The same notification replaced, on the channel without sound or vibration, silent.
      expect(first[0].identifier).toBe(`safe-folded:${circleId}:${ayseUserId}`);
      expect(second[0].identifier).toBe(first[0].identifier);
      expect(first[0].trigger).toEqual({ channelId: SAFE_QUIET_CHANNEL });
      expect(first[0].content).toMatchObject({
        title: 'Aile',
        sound: false,
        data: { circleId },
        body: 'Ayşe: 1 iyiyim mesajı daha geldi, çok sık olduğu için tek tek gösterilmiyor',
      });
      expect(second[0].content).toMatchObject({
        body: 'Ayşe: 2 iyiyim mesajı daha geldi, çok sık olduğu için tek tek gösterilmiyor',
      });
      // The ones shown loudly have the loud channel and no `identifier` to replace.
      const loud = scheduled.mock.calls[0] as [Record<string, unknown>];
      expect(loud[0].trigger).toEqual({ channelId: 'social' });
      // Nothing of a folded message is kept: no place on the phone.
      expect(loadSpots(mockStore, at(8)).map((spot) => spot.id)).toEqual([
        idOf(0),
        idOf(1),
        idOf(2),
        idOf(3),
        idOf(4),
        idOf(5),
      ]);
    });

    it('is one plain line in the open app, once, with no haptic', async () => {
      appIs('active');
      for (let n = 0; n < 6; n += 1) {
        await showPush(fromAyse(safe({ id: idOf(n) })), at(n));
      }
      toasted.mockClear();
      toastNotice.mockClear();
      expect(await showPush(fromAyse(safe({ id: idOf(6) })), at(6))).toBe('folded');
      expect(await showPush(fromAyse(safe({ id: idOf(7) })), at(7))).toBe('folded');
      expect(await showPush(fromAyse(safe({ id: idOf(8) })), at(8))).toBe('folded');
      // `info` is the line without a haptic (only a `success` one vibrates); `notice` is the tap-able
      // one of a message that is shown.
      expect(toasted).toHaveBeenCalledTimes(1);
      expect(toasted).toHaveBeenCalledWith(
        'Ayşe: 1 iyiyim mesajı daha geldi, çok sık olduğu için tek tek gösterilmiyor',
      );
      expect(toastNotice).not.toHaveBeenCalled();
      expect(scheduled).not.toHaveBeenCalled();
    });

    it('counts the open app and the notification together, and each person and circle on their own', async () => {
      // Six came live (the open app showed them)...
      for (let n = 0; n < 6; n += 1) admitSafe(mockStore, circleId, ayseUserId, at(n));
      // ...the seventh, by notification, is folded.
      expect(await showPush(fromAyse(safe({ id: idOf(6) })), at(6))).toBe('folded');
      // Another circle of hers, and another person in this one, have their own six.
      expect(await showPush(fromAyse(safe({ id: idOf(7), circleId: randomUuid() })), at(7))).toBe(
        'shown',
      );
      const carol = generateDeviceKeys(randomUuid());
      saveContacts(mockStore, {
        ...contacts,
        devices: {
          ...contacts.devices,
          [carol.deviceId]: {
            userId: randomUuid(),
            name: 'Cem',
            identityKey: toBase64url(carol.identity.publicKey),
          },
        },
      });
      expect(
        await showPush(sealPush({ recipient, sender: carol, body: safe({ id: idOf(8) }) }), at(8)),
      ).toBe('shown');
    });

    it('lets one through again an hour after the first was shown, and is not a mute', async () => {
      saveMutes(mockStore, {
        people: { [ayseUserId]: { places: true, pokes: true } },
        places: {},
      });
      for (let n = 0; n < 6; n += 1) {
        expect(await showPush(fromAyse(safe({ id: idOf(n) })), at(n))).toBe('shown');
      }
      expect(await showPush(fromAyse(safe({ id: idOf(6) })), at(6))).toBe('folded');
      const hour = 60 * 60_000;
      expect(await showPush(fromAyse(safe({ id: idOf(7), ts: at(7) + hour })), at(0) + hour)).toBe(
        'shown',
      );
    });
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
        userId: ayseUserId,
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

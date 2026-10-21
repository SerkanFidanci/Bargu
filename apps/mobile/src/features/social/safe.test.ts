import {
  applyPrecision,
  decryptMessage,
  openPush,
  ReplayGuard,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import { type Circle, safeIdSchema, type SafePayload, type SafeRequest } from '@bargu/schemas';

import i18n from '@/i18n';

import { createReceiver } from '../location/receive';
import { DEFAULT_SHARING, type SharingSettings, type CircleSharing } from '../location/sharing';
import {
  circleOf,
  exchangeKeys,
  GALATA,
  memoryStore,
  nth,
  type Person,
  somebody,
} from '../location/test-support';
import { contactsOf, identityOf } from '../notifications/push-contacts';
import {
  createSafeCheckIns,
  initialSelection,
  loadChoice,
  needsConfirm,
  receiveSafe,
  rememberSafe,
  SAFE_AHEAD_MS,
  SAFE_FRESH_MS,
  safeAge,
  SAFE_KEEP_MS,
  safeRows,
  safeWords,
} from './safe';
import { spotOf } from './safe-spot';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

/** The sharing choices of a circle: its precision, shared or not. */
const sharingOf = (circle: Circle, change: Partial<CircleSharing>): SharingSettings => ({
  ...DEFAULT_SHARING,
  circles: { [circle.id]: { sharing: true, precision: 'exact', until: null, ...change } },
});

interface World {
  ayse: Person;
  bora: Person;
  home: Circle;
  club: Circle;
  /** The circles this phone knows; taking one out is leaving it. */
  circles: Circle[];
  clock: { now: number };
  settings: { current: SharingSettings };
  send: jest.Mock<Promise<unknown>, [SafeRequest]>;
  refresh: jest.Mock<Promise<void>, [string]>;
  waiting: number[];
  make: (store?: ReturnType<typeof memoryStore>) => ReturnType<typeof createSafeCheckIns>;
  /** What Bora's phone reads of a request to a circle. */
  read: (request: SafeRequest, circle: Circle) => SafePayload;
}

function world(
  options: { fix?: typeof GALATA | null; battery?: number; permanent?: boolean } = {},
): World {
  const [ayse, bora] = [somebody(), somebody()];
  const home = circleOf([ayse, bora], { name: 'Aile' });
  const club = circleOf([ayse, bora], { name: 'Kulüp' });
  exchangeKeys(home, [ayse, bora]);
  exchangeKeys(club, [ayse, bora]);
  const clock = { now: NOW };
  const settings = { current: DEFAULT_SHARING };
  const send = jest.fn<Promise<unknown>, [SafeRequest]>(() => Promise.resolve({ ok: true }));
  const refresh = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
  const waiting: number[] = [];
  const circles: Circle[] = [home, club];
  const fix = options.fix === undefined ? GALATA : options.fix;
  return {
    ayse,
    bora,
    home,
    club,
    circles,
    clock,
    settings,
    send,
    refresh,
    waiting,
    make: (store = ayse.store) =>
      createSafeCheckIns({
        store: () => store,
        keys: () => ayse.keys,
        device: () => ayse.device,
        circles: () => circles,
        recipients: (circleId) =>
          contactsOf(circles, ayse.keys, ayse.userId).recipients[circleId] ?? [],
        sharing: () => settings.current,
        fix: () => Promise.resolve(fix === null ? null : { ...fix, ts: NOW - 5_000 }),
        battery: () => Promise.resolve(options.battery ?? 45.4),
        send: (request) => send(request),
        permanent: () => options.permanent ?? false,
        refresh: (circleId) => refresh(circleId),
        onWaiting: (count) => {
          waiting.push(count);
        },
        now: () => clock.now,
      }),
    read: (request, circle) => {
      const card = nth(circle.members.filter((member) => member.userId === ayse.userId)).device;
      const senderKey = bora.keys.receivedKey(circle.id, circle.epoch, ayse.device.deviceId);
      if (card === null || senderKey === null) throw new Error('bora cannot read');
      const payload = decryptMessage({
        envelope: request.envelope,
        senderKey,
        sender: verifyDeviceKeyBundle(card.bundle),
        replay: new ReplayGuard(),
      });
      if (payload.kind !== 'safe') throw new Error(`not a safe message: ${payload.kind}`);
      return payload;
    },
  };
}

/** Lets every promise that can settle settle. */
const nextTurn = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const queued = (store: ReturnType<typeof memoryStore>) =>
  store.keys().filter((key) => key.startsWith('safe:out:'));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('telling the circles (docs/ADR/0029)', () => {
  it('makes a message per circle at THAT circle’s precision, sealed for the members, with the battery', async () => {
    const w = world();
    w.settings.current = sharingOf(w.club, { precision: 'neighborhood' });
    const safe = w.make();

    const report = await safe.tell([w.home.id, w.club.id]);

    expect(report).toEqual({ status: 'sent', sent: 2, waiting: 0, limited: 0 });
    expect(w.send).toHaveBeenCalledTimes(2);
    const toHome = nth(
      w.send.mock.calls.filter(([request]) => request.envelope.circleId === w.home.id),
    )[0];
    const toClub = nth(
      w.send.mock.calls.filter(([request]) => request.envelope.circleId === w.club.id),
    )[0];

    // The exact circle gets the exact place; the coarse one the cell, with a matching accuracy.
    const exact = w.read(toHome, w.home);
    expect(exact).toMatchObject({
      kind: 'safe',
      lat: GALATA.lat,
      lng: GALATA.lng,
      acc: 8,
      bat: 45,
    });
    const coarse = w.read(toClub, w.club);
    const cell = applyPrecision(
      { kind: 'loc', lat: GALATA.lat, lng: GALATA.lng, acc: 8, bat: 45, chg: false, ts: NOW },
      'neighborhood',
    );
    expect(coarse).toMatchObject({ lat: cell.lat, lng: cell.lng, acc: cell.acc, bat: 45 });
    expect(coarse.lat).not.toBe(GALATA.lat);
    expect(coarse.acc).toBeGreaterThan(500);
    // The finer place is nowhere in what the coarse circle gets, notification included.
    expect(JSON.stringify(toClub)).not.toContain(String(GALATA.lat));

    // Each message has its own id (22 characters, as the server's schema wants), and the same one
    // in the request, the message and the notification.
    expect(safeIdSchema.safeParse(toHome.id).success).toBe(true);
    expect(toHome.id).not.toBe(toClub.id);
    expect(exact.id).toBe(toHome.id);
    expect(exact.ts).toBe(NOW);

    // Bora's phone, closed: the notification is signed by Ayşe's device and says the battery only.
    const push = nth(toHome.pushes ?? []);
    expect(push.userId).toBe(w.bora.userId);
    const contacts = contactsOf([w.home, w.club], w.bora.keys, w.bora.userId);
    const opened = openPush({
      recipient: w.bora.device,
      sealed: push.sealed,
      senderIdentityKey: (deviceId) => identityOf(contacts, deviceId),
    });
    expect(opened).toEqual({
      senderDeviceId: w.ayse.device.deviceId,
      // The place is in it, the same as in the message (this circle's precision), and no name or text.
      body: {
        kind: 'safe',
        circleId: w.home.id,
        id: toHome.id,
        bat: 45,
        lat: GALATA.lat,
        lng: GALATA.lng,
        acc: 8,
        ts: NOW,
      },
      serverSignature: null,
    });
    // The coarse circle's notification has the coarse place only, the same as its message.
    const clubPush = nth(toClub.pushes ?? []);
    const clubOpened = openPush({
      recipient: w.bora.device,
      sealed: clubPush.sealed,
      senderIdentityKey: (deviceId) => identityOf(contacts, deviceId),
    });
    expect(clubOpened.body).toMatchObject({
      kind: 'safe',
      lat: cell.lat,
      lng: cell.lng,
      acc: cell.acc,
    });
    // Nothing waits afterwards.
    expect(queued(w.ayse.store)).toEqual([]);
  });

  it('keeps nothing finer than a circle’s precision on the phone either, while a message waits', async () => {
    const w = world();
    w.settings.current = sharingOf(w.club, { precision: 'city' });
    w.send.mockRejectedValue(new Error('network'));
    await w.make().tell([w.club.id]);

    const [key] = queued(w.ayse.store);
    const item = JSON.parse(w.ayse.store.get(key ?? '') ?? '{}') as { lat: number; lng: number };
    expect(item.lat).not.toBe(GALATA.lat);
    expect(item.lng).not.toBe(GALATA.lng);
    expect(JSON.stringify(item)).not.toContain(String(GALATA.lat));
  });

  it('says what the phone cannot do: no location, no circle', async () => {
    const lost = world({ fix: null });
    expect(await lost.make().tell([lost.home.id])).toMatchObject({ status: 'noLocation' });
    expect(lost.send).not.toHaveBeenCalled();
    expect(queued(lost.ayse.store)).toEqual([]);

    const w = world();
    expect(await w.make().tell([])).toMatchObject({ status: 'nothing' });
    expect(await w.make().tell(['0190f7a4-0000-7000-8000-00000000dead'])).toMatchObject({
      status: 'nothing',
    });
    expect(w.send).not.toHaveBeenCalled();
  });
});

describe('weak network and airplane mode (BARGU_PLAN Faz 9B)', () => {
  it('waits in the vault, goes once when the connection returns, and never again', async () => {
    const w = world();
    const safe = w.make();
    w.send.mockRejectedValue(new Error('airplane mode'));

    const report = await safe.tell([w.home.id, w.club.id]);
    expect(report).toEqual({ status: 'waiting', sent: 0, waiting: 2, limited: 0 });
    expect(queued(w.ayse.store)).toHaveLength(2);
    expect(safe.waiting()).toBe(2);
    expect(w.waiting.at(-1)).toBe(2);
    // The first tries: one request (it stops at the first that gets no answer), in order.
    expect(w.send).toHaveBeenCalledTimes(1);
    const firstTry = nth(w.send.mock.calls)[0];

    // Still no network: a reconnection that fails again changes nothing.
    await safe.flush();
    expect(queued(w.ayse.store)).toHaveLength(2);

    // The network is back.
    w.send.mockClear();
    w.send.mockResolvedValue({ ok: true });
    await safe.flush();
    expect(w.send).toHaveBeenCalledTimes(2);
    const ids = w.send.mock.calls.map(([request]) => request.id);
    expect(new Set(ids).size).toBe(2);
    // The one that was tried before goes with the SAME id (the server drops a repeat of it).
    expect(ids).toContain(firstTry.id);
    expect(queued(w.ayse.store)).toEqual([]);
    expect(w.waiting.at(-1)).toBe(0);

    // Another reconnection, and a restart of the app: nothing is sent again.
    w.send.mockClear();
    await safe.flush();
    await w.make().flush();
    await w.make(w.ayse.store).flush();
    expect(w.send).not.toHaveBeenCalled();
  });

  it('asks again with the same id if the phone died before it noted the answer', async () => {
    const w = world();
    const real = w.ayse.store;
    // The vault fails to delete: the answer came, then the app was killed.
    const dying = {
      ...real,
      delete: () => {
        throw new Error('killed');
      },
    };
    w.send.mockRejectedValueOnce(new Error('airplane mode'));
    const first = w.make(real);
    await first.tell([w.home.id]);
    const earlier = nth(w.send.mock.calls)[0].id;

    w.send.mockClear();
    w.send.mockResolvedValue({ ok: true });
    await expect(w.make(dying).flush()).rejects.toThrow('killed');
    expect(w.send).toHaveBeenCalledTimes(1);
    expect(queued(real)).toHaveLength(1);

    // After the restart it is still there, and goes with the same id: the server answers "done".
    w.send.mockClear();
    await w.make(real).flush();
    expect(nth(w.send.mock.calls)[0].id).toBe(earlier);
    expect(queued(real)).toEqual([]);
  });

  it('seals again at every try: a new sequence number and the circle’s epoch as it is then', async () => {
    const w = world();
    w.send.mockRejectedValueOnce(new Error('airplane mode'));
    const safe = w.make();
    await safe.tell([w.home.id]);
    await safe.flush();
    const [first, second] = w.send.mock.calls.map(([request]) => request.envelope);
    expect(first?.seq).not.toBe(second?.seq);
    expect(first?.salt).not.toBe(second?.salt);
  });

  it('lets a message go after a day, and one for a circle the phone left', async () => {
    const w = world();
    w.send.mockRejectedValue(new Error('airplane mode'));
    const safe = w.make();
    await safe.tell([w.home.id, w.club.id]);
    w.send.mockClear();
    w.send.mockResolvedValue({ ok: true });
    w.clock.now = NOW + SAFE_KEEP_MS + 1;
    await safe.flush();
    expect(w.send).not.toHaveBeenCalled();
    expect(queued(w.ayse.store)).toEqual([]);

    const left = world();
    left.send.mockRejectedValue(new Error('airplane mode'));
    const away = left.make();
    await away.tell([left.home.id]);
    left.circles.splice(0, 1);
    left.send.mockClear();
    left.send.mockResolvedValue({ ok: true });
    await away.flush();
    expect(left.send).not.toHaveBeenCalled();
    expect(queued(left.ayse.store)).toEqual([]);
  });

  it('handles the server’s refusals: too often is dropped, not a member is dropped and fetched, a stale epoch is tried once more', async () => {
    const w = world();
    const safe = w.make();
    w.send.mockResolvedValue({ refused: 'RATE_LIMITED' });
    expect(await safe.tell([w.home.id])).toEqual({
      status: 'sent',
      sent: 0,
      waiting: 0,
      limited: 1,
    });
    expect(queued(w.ayse.store)).toEqual([]);

    w.send.mockResolvedValue({ refused: 'NOT_MEMBER' });
    await safe.tell([w.home.id]);
    expect(queued(w.ayse.store)).toEqual([]);
    expect(w.refresh).toHaveBeenCalledWith(w.home.id);

    // The circle moved on without this phone: fetched, and sent again (a new epoch is read then).
    w.refresh.mockClear();
    w.send.mockReset();
    w.send.mockResolvedValueOnce({ refused: 'EPOCH' }).mockResolvedValue({ ok: true });
    expect(await safe.tell([w.home.id])).toMatchObject({ status: 'sent', sent: 1 });
    expect(w.refresh).toHaveBeenCalledTimes(1);
    expect(w.send).toHaveBeenCalledTimes(2);

    // Still the wrong epoch after that: it waits for the next connection and is not lost.
    w.send.mockReset();
    w.send.mockResolvedValue({ refused: 'EPOCH' });
    expect(await safe.tell([w.home.id])).toMatchObject({ status: 'waiting', waiting: 1 });
    expect(queued(w.ayse.store)).toHaveLength(1);
  });

  it('drops what the server will never take (a bad request), and keeps what only waits (a server error)', async () => {
    const bad = world({ permanent: true });
    bad.send.mockRejectedValue(new Error('400'));
    await bad.make().tell([bad.home.id]);
    expect(queued(bad.ayse.store)).toEqual([]);

    const down = world({ permanent: false });
    down.send.mockRejectedValue(new Error('503'));
    await down.make().tell([down.home.id]);
    expect(queued(down.ayse.store)).toHaveLength(1);
  });

  it('never sends one message in two requests at once', async () => {
    const w = world();
    let release: (reply: unknown) => void = () => undefined;
    w.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const safe = w.make();
    const told = safe.tell([w.home.id]);
    await nextTurn();
    expect(w.send).toHaveBeenCalledTimes(1);
    // A reconnection while the first request is still out waits for it.
    const again = safe.flush();
    await nextTurn();
    expect(w.send).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await told;
    await again;
    expect(w.send).toHaveBeenCalledTimes(1);
  });
});

describe('which circles, and what the user is asked first', () => {
  it('lists the circles one can tell, labels the coarse ones, and includes a paused one', () => {
    const w = world();
    const paused: Circle = { ...circleOf([w.ayse, w.bora], { name: 'Duraklamış' }), paused: true };
    const alone = circleOf([w.ayse], { name: 'Yalnız' });
    const over: Circle = { ...circleOf([w.ayse, w.bora], { name: 'Bitti' }), expiresAt: NOW - 1 };
    const invited = circleOf([w.ayse, w.bora], { name: 'Davet', myStatus: 'invited' });
    const settings = sharingOf(w.club, { precision: 'neighborhood' });
    const rows = safeRows(
      [w.home, w.club, paused, alone, over, invited],
      settings,
      w.ayse.userId,
      NOW,
    );

    expect(rows.map((row) => row.title)).toEqual(['Aile', 'Kulüp', 'Duraklamış']);
    expect(rows.map((row) => row.coarse)).toEqual([false, true, false]);
    expect(rows.every((row) => !row.unshared)).toBe(true);
  });

  it('names a friendship after the friend', () => {
    const w = world();
    const pair = circleOf([w.ayse, w.bora], { kind: 'pair', name: null });
    const rows = safeRows([pair], DEFAULT_SHARING, w.ayse.userId, NOW);
    expect(rows).toHaveLength(1);
    expect(nth(rows).title).toBe('Test');
  });

  it('marks the circles that do not get the location now: a ghost, sharing off, a timed share over', () => {
    const w = world();
    const rowsOf = (settings: SharingSettings) =>
      safeRows([w.home, w.club], settings, w.ayse.userId, NOW).map((row) => row.unshared);

    expect(rowsOf(DEFAULT_SHARING)).toEqual([false, false]);
    expect(rowsOf({ ...DEFAULT_SHARING, ghost: 'hide' })).toEqual([true, true]);
    expect(rowsOf({ ...DEFAULT_SHARING, ghost: 'freeze' })).toEqual([true, true]);
    expect(rowsOf(sharingOf(w.club, { sharing: false }))).toEqual([false, true]);
    expect(rowsOf(sharingOf(w.club, { until: NOW - 1 }))).toEqual([false, true]);
    expect(rowsOf({ ...DEFAULT_SHARING, newCircles: 'off' })).toEqual([true, true]);
  });

  it('asks first ("Konumun bu kez paylaşılacak") only when a chosen circle does not see the location now', () => {
    const w = world();
    const calm = safeRows([w.home, w.club], DEFAULT_SHARING, w.ayse.userId, NOW);
    expect(needsConfirm(calm, [w.home.id, w.club.id])).toBe(false);

    const ghost = safeRows(
      [w.home, w.club],
      { ...DEFAULT_SHARING, ghost: 'hide' },
      w.ayse.userId,
      NOW,
    );
    expect(needsConfirm(ghost, [w.home.id])).toBe(true);
    expect(needsConfirm(ghost, [])).toBe(false);

    const off = safeRows(
      [w.home, w.club],
      sharingOf(w.club, { sharing: false }),
      w.ayse.userId,
      NOW,
    );
    expect(needsConfirm(off, [w.home.id])).toBe(false);
    expect(needsConfirm(off, [w.home.id, w.club.id])).toBe(true);
  });

  it('remembers the last choice and ticks it again, but never a circle that came since', async () => {
    const w = world();
    const safe = w.make();
    expect(loadChoice(w.ayse.store)).toBeNull();
    await safe.tell([w.club.id]);
    expect(loadChoice(w.ayse.store)).toEqual([w.club.id]);

    const rows = safeRows([w.home, w.club], DEFAULT_SHARING, w.ayse.userId, NOW);
    expect(initialSelection(rows, loadChoice(w.ayse.store))).toEqual([w.club.id]);
    // A circle left since drops out of the choice; with no memory, those that see the location.
    expect(initialSelection(rows.slice(0, 1), [w.club.id])).toEqual([]);
    expect(initialSelection(rows, null)).toEqual([w.home.id, w.club.id]);
    const ghostRows = safeRows(
      [w.home, w.club],
      { ...DEFAULT_SHARING, ghost: 'hide' },
      w.ayse.userId,
      NOW,
    );
    expect(initialSelection(ghostRows, null)).toEqual([]);

    // The choice is also kept when nothing could be sent.
    w.send.mockRejectedValue(new Error('airplane mode'));
    await safe.tell([w.home.id]);
    expect(loadChoice(w.ayse.store)).toEqual([w.home.id]);
  });
});

describe('the receiving phone, from the envelope to the handler', () => {
  it('hands a message it could verify to the handler once, with who sent it and for which circle', async () => {
    const w = world();
    await w.make().tell([w.home.id]);
    const request = nth(w.send.mock.calls)[0];
    const heard: [string, string, string, number][] = [];
    const receiver = createReceiver({
      keys: () => w.bora.keys,
      circles: () => w.circles,
      store: () => w.bora.store,
      onSafe: (circleId, userId, safe) => {
        heard.push([circleId, userId, safe.id, safe.bat]);
      },
      now: () => NOW,
    });

    expect(receiver.receive(request.envelope, 'safe')).toBe('shown');
    expect(heard).toEqual([[w.home.id, w.ayse.userId, request.id, 45]]);
    // The server (or the network) hands the very same envelope over again: it is a replay.
    expect(receiver.receive(request.envelope, 'safe')).toBe('ignored');
    expect(heard).toHaveLength(1);
    // A phone with no handler for it (an app that does not show these) just ignores it quietly.
    const quiet = createReceiver({
      keys: () => w.bora.keys,
      circles: () => w.circles,
      store: () => memoryStore(),
      now: () => NOW,
    });
    expect(quiet.receive(request.envelope, 'safe')).toBe('shown');
  });
});

describe('what the receiving phone writes', () => {
  it('says who, that they are safe and the battery, in the phone’s language', async () => {
    expect(safeWords({ name: 'Ayşe', bat: 45, ts: NOW, now: NOW + MIN })).toBe(
      'Ayşe: İyiyim ✓ · %45',
    );
    await i18n.changeLanguage('en');
    expect(safeWords({ name: 'Ayşe', bat: 45, ts: NOW, now: NOW + MIN })).toBe(
      "Ayşe: I'm safe ✓ · 45%",
    );
    await i18n.changeLanguage('tr');
  });

  it('adds the time when the message came late (it waited for a connection)', () => {
    const words = safeWords({ name: 'Ayşe', bat: 8, ts: NOW, now: NOW + 3 * 60 * MIN });
    expect(words).toMatch(/^Ayşe: İyiyim ✓ · %8 · \d{2}[:.]\d{2}$/);
  });

  it('shows a message from a member once, however many times it comes', () => {
    const w = world();
    const store = memoryStore();
    const safe: SafePayload = {
      kind: 'safe',
      id: 'AAAAAAAAAAAAAAAAAAAAAA',
      lat: 41,
      lng: 29,
      acc: 8,
      bat: 45,
      ts: NOW,
    };
    const input = {
      store,
      circles: [w.home],
      circleId: w.home.id,
      userId: w.bora.userId,
      safe,
      now: NOW + MIN,
    };
    const spot = {
      id: safe.id,
      circleId: w.home.id,
      name: 'Test',
      lat: 41,
      lng: 29,
      acc: 8,
      bat: 45,
      ts: NOW,
    };
    expect(receiveSafe(input)).toEqual({ text: 'Test: İyiyim ✓ · %45', spot });
    // The place is kept on the phone (a tap on the line shows it) and nowhere else.
    expect(spotOf(store, safe.id, NOW + MIN)).toEqual(spot);
    // The same message again: the open app and the notification, or a repeat from the server.
    expect(receiveSafe(input)).toBeNull();
    expect(rememberSafe(store, w.home.id, w.bora.userId, safe.id)).toBe(false);
    // Another message is another.
    expect(
      receiveSafe({ ...input, safe: { ...safe, id: 'AAAAAAAAAAAAAAAAAAAAAQ' } }),
    ).not.toBeNull();
  });

  it('remembers a message by its circle, its sender and its id: nobody else can use up the id (QA-32 F-2)', () => {
    const w = world();
    const mallory = somebody();
    const circle = circleOf([w.ayse, w.bora, mallory], { name: 'Üçlü' });
    const store = memoryStore();
    const safe = (id: string): SafePayload => ({
      kind: 'safe',
      id,
      lat: 41,
      lng: 29,
      acc: 8,
      bat: 45,
      ts: NOW,
    });
    const from = (who: Person, id: string, inCircle: Circle = circle) =>
      receiveSafe({
        store,
        circles: [circle, w.home],
        circleId: inCircle.id,
        userId: who.userId,
        safe: safe(id),
        now: NOW + MIN,
      });
    const id = 'AAAAAAAAAAAAAAAAAAAAAA';

    // A member sends the id first (they saw it in a message of the real sender, or guessed it)...
    expect(from(mallory, id)).not.toBeNull();
    // ...and the real sender's message with that id still shows: it is another sender's message.
    expect(from(w.ayse, id)).not.toBeNull();
    // The same sender's message in another circle is another message too.
    expect(from(mallory, id, w.home)).toBeNull(); // mallory is not in "home": nothing to show
    expect(rememberSafe(store, w.home.id, w.ayse.userId, id)).toBe(true);
    // But the same circle, sender and id is the same message.
    expect(from(w.ayse, id)).toBeNull();
    expect(from(mallory, id)).toBeNull();
    expect(rememberSafe(store, circle.id, w.ayse.userId, id)).toBe(false);
    expect(rememberSafe(store, circle.id, mallory.userId, id)).toBe(false);
    expect(rememberSafe(store, circle.id, w.bora.userId, id)).toBe(true);
  });

  it('takes a message dated up to five minutes ahead and drops one dated further (a wrong clock, or made up)', () => {
    const w = world();
    const at = (ts: number, id: string) =>
      receiveSafe({
        store: memoryStore(),
        circles: [w.home],
        circleId: w.home.id,
        userId: w.bora.userId,
        safe: { kind: 'safe', id, lat: 41, lng: 29, acc: 8, bat: 45, ts },
        now: NOW,
      });
    expect(SAFE_AHEAD_MS).toBe(5 * MIN);
    // Boundaries, to the millisecond: ahead by five minutes is fine, a millisecond more is not.
    expect(at(NOW + SAFE_AHEAD_MS, 'AAAAAAAAAAAAAAAAAAAAAA')).not.toBeNull();
    expect(at(NOW + SAFE_AHEAD_MS + 1, 'AAAAAAAAAAAAAAAAAAAAAQ')).toBeNull();
    expect(at(NOW + 24 * 60 * MIN, 'AAAAAAAAAAAAAAAAAAAAAg')).toBeNull();
    // Behind: a day is fine, a millisecond more is too old.
    expect(at(NOW - SAFE_FRESH_MS, 'AAAAAAAAAAAAAAAAAAAAAw')).not.toBeNull();
    expect(at(NOW - SAFE_FRESH_MS - 1, 'AAAAAAAAAAAAAAAAAAAABA')).toBeNull();
    expect(safeAge(NOW + SAFE_AHEAD_MS, NOW)).toBe('fresh');
    expect(safeAge(NOW + SAFE_AHEAD_MS + 1, NOW)).toBe('ahead');
    expect(safeAge(NOW - SAFE_FRESH_MS, NOW)).toBe('fresh');
    expect(safeAge(NOW - SAFE_FRESH_MS - 1, NOW)).toBe('old');
    // The ones dropped did not use up their ids (each had its own store here, so: not remembered).
    const store = memoryStore();
    const input = {
      store,
      circles: [w.home],
      circleId: w.home.id,
      userId: w.bora.userId,
      now: NOW,
    };
    const safe: SafePayload = {
      kind: 'safe',
      id: 'AAAAAAAAAAAAAAAAAAAAAA',
      lat: 41,
      lng: 29,
      acc: 8,
      bat: 45,
      ts: NOW,
    };
    expect(receiveSafe({ ...input, safe: { ...safe, ts: NOW + 10 * MIN } })).toBeNull();
    expect(receiveSafe({ ...input, safe })).not.toBeNull();
  });

  it('shows nothing for a message that is too old, or from someone who is not in the circle', () => {
    const w = world();
    const store = memoryStore();
    const safe: SafePayload = {
      kind: 'safe',
      id: 'AAAAAAAAAAAAAAAAAAAAAA',
      lat: 41,
      lng: 29,
      acc: 8,
      bat: 45,
      ts: NOW,
    };
    const base = { store, circles: [w.home], circleId: w.home.id, userId: w.bora.userId, safe };
    expect(receiveSafe({ ...base, now: NOW + SAFE_FRESH_MS + 1 })).toBeNull();
    expect(
      receiveSafe({ ...base, userId: '0190f7a4-0000-7000-8000-00000000dead', now: NOW }),
    ).toBeNull();
    expect(receiveSafe({ ...base, circleId: w.club.id, now: NOW })).toBeNull();
    // None of those used up the id: the real one still shows.
    expect(receiveSafe({ ...base, now: NOW })).not.toBeNull();
  });
});

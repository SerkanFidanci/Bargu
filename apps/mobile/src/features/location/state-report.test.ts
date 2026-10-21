import { decryptMessage, ReplayGuard } from '@bargu/crypto';
import type { BumpReply, PlaceEventRequest, StatePayload } from '@bargu/schemas';

import { verifiedBundle } from '../keys/bundle-cache';
import { createLocationEngine, type SendCircle, toSendCircle } from './engine';
import { createReceiver, useLocations } from './receive';
import {
  createStateReporter,
  NOFIX_AFTER_MS,
  reasonOf,
  RETRY_MS,
  STATE_GAP_MS,
} from './state-report';
import { SEND_RULES } from './send';
import { DEFAULT_SHARING, type SharingSettings } from './sharing';
import { circleOf, exchangeKeys, GALATA, moved, nth, somebody } from './test-support';
import { newestState, useStates, whyShown } from './why';

// "Neden eski?" (docs/ADR/0028): what a phone tells its circles about why its location is old.
const START = 1_800_000_000_000;
const MINUTE = 60_000;
const HEARTBEAT = SEND_RULES.heartbeatMs;

function setup(circleCount = 2) {
  const me = somebody();
  const friend = somebody();
  const full = Array.from({ length: circleCount }, () => circleOf([me, friend]));
  for (const circle of full) exchangeKeys(circle, [me, friend]);
  const circles: SendCircle[] = full.map((circle) => toSendCircle(circle, me.userId));
  let settings: SharingSettings = DEFAULT_SHARING;
  const sent: PlaceEventRequest[] = [];
  const outdated: string[][] = [];
  let reply: (request: PlaceEventRequest) => Promise<BumpReply> = () =>
    Promise.resolve({ ok: true });
  const reporter = createStateReporter({
    keys: () => me.keys,
    device: () => me.device,
    audience: () => engine.audience(),
    holding: () => engine.holding(),
    send: (request) => {
      sent.push(request);
      return reply(request);
    },
    outdated: (circleIds) => {
      outdated.push(circleIds);
    },
  });
  const engine = createLocationEngine({
    keys: () => me.keys,
    device: () => me.device,
    circles: () => circles,
    sharing: () => settings,
    store: () => me.store,
    battery: () => Promise.resolve({ level: 80, charging: false }),
    publish: (envelopes) => Promise.resolve({ accepted: envelopes.length, refused: [] }),
    withdraw: () => Promise.resolve(),
    sampled: (at) => {
      reporter.sampled(at);
    },
    settled: () => {
      void reporter.changed();
    },
  });

  /** What the friend's phone opens from a request. */
  const open = (request: PlaceEventRequest): StatePayload => {
    const { envelope } = request;
    const circle = full.find((candidate) => candidate.id === envelope.circleId);
    const device = circle?.members.find((member) => member.userId === me.userId)?.device;
    const key = friend.keys.receivedKey(envelope.circleId, envelope.epoch, me.device.deviceId);
    if (device === undefined || device === null || key === null) {
      throw new Error('the friend cannot open it');
    }
    const payload = decryptMessage({
      envelope,
      senderKey: key,
      sender: verifiedBundle(device.bundle),
      replay: new ReplayGuard(),
    });
    if (payload.kind !== 'state') throw new Error(`not a state: ${payload.kind}`);
    return payload;
  };

  return {
    engine,
    reporter,
    me,
    friend,
    full,
    circles,
    sent,
    outdated,
    states: () => sent.map(open),
    open,
    /** The circles the requests from `index` on went to. */
    toCircles: (from = 0) => sent.slice(from).map((request) => request.envelope.circleId),
    share: (next: SharingSettings) => {
      settings = next;
    },
    setReply: (next: typeof reply) => {
      reply = next;
    },
    /** A healthy phone for this many minutes: a new position every minute. */
    async healthy(minutes: number) {
      for (let i = 1; i <= minutes; i += 1) {
        await jest.advanceTimersByTimeAsync(MINUTE);
        await engine.fix({ ...moved(GALATA, 20 * i, Date.now()), ts: Date.now() });
      }
    },
    /** A first location out, so friends hold one (the reasons explain it). */
    async located(ms = 0) {
      await engine.fix({ ...moved(GALATA, 10, Date.now() + ms), ts: Date.now() + ms });
      await settle();
    },
  };
}

/** Lets what a message set going (a send, the next timer) finish. */
const settle = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers({ now: START });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the reason a phone gives (state)', () => {
  it('goes out when the reason starts, one message to each circle it shares with', async () => {
    const t = setup();
    await t.located();
    expect(t.sent).toHaveLength(0);
    await t.reporter.set({ saver: true });
    expect(t.sent).toHaveLength(2);
    expect(t.toCircles().sort()).toEqual(t.circles.map((circle) => circle.id).sort());
    for (const state of t.states()) {
      expect(state).toEqual({ kind: 'state', why: 'saver', since: START, ts: START });
    }
    // Nobody is notified: no sealed pushes ride along.
    expect(t.sent.every((request) => request.pushes.length === 0)).toBe(true);
    t.reporter.reset();
  });

  it('reaches the friend: the same message, over the live path, shows as the label', async () => {
    const t = setup(1);
    useLocations.setState({}, true);
    useStates.setState({}, true);
    const friendsPhone = createReceiver({
      keys: () => t.friend.keys,
      circles: () => t.full,
      store: () => t.friend.store,
    });
    await t.located();
    await t.reporter.set({ saver: true });
    for (const request of t.sent) expect(friendsPhone.receive(request.envelope)).toBe('shown');
    // Their screen, twelve minutes on: the location (from START) is old, the reason is renewed.
    await jest.advanceTimersByTimeAsync(12 * MINUTE);
    for (const request of t.sent.slice(1)) friendsPhone.receive(request.envelope);
    const state = newestState(useStates.getState(), t.me.userId);
    expect(whyShown({ loc: { ts: START }, state, now: Date.now() })).toEqual({
      kind: 'saver',
      since: START,
    });
    t.reporter.reset();
  });

  it('repeats with the 5-minute heartbeat while it lasts, with the same start', async () => {
    const t = setup();
    await t.located();
    await t.reporter.set({ saver: true });
    await jest.advanceTimersByTimeAsync(HEARTBEAT - 1);
    expect(t.sent).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.sent).toHaveLength(4);
    await jest.advanceTimersByTimeAsync(HEARTBEAT);
    expect(t.sent).toHaveLength(6);
    for (const state of t.states()) expect(state).toMatchObject({ why: 'saver', since: START });
    expect(t.states().map((state) => state.ts)).toEqual([
      START,
      START,
      START + HEARTBEAT,
      START + HEARTBEAT,
      START + 2 * HEARTBEAT,
      START + 2 * HEARTBEAT,
    ]);
    t.reporter.reset();
  });

  it('clears when the reason ends, and then stays quiet', async () => {
    const t = setup();
    await t.located();
    await t.reporter.set({ saver: true });
    await jest.advanceTimersByTimeAsync(MINUTE);
    await t.reporter.set({ saver: false });
    expect(t.sent).toHaveLength(4);
    for (const state of t.states().slice(2)) {
      expect(state).toMatchObject({ why: 'none', ts: START + MINUTE });
    }
    // Positions keep coming, as from a healthy phone: nothing more is said.
    await t.healthy(30);
    expect(t.sent).toHaveLength(4);
    t.reporter.reset();
  });

  it('says a new reason when it changes, with its own start', async () => {
    const t = setup(1);
    await t.located();
    await t.reporter.set({ saver: true });
    await jest.advanceTimersByTimeAsync(MINUTE);
    await t.reporter.set({ permissionOff: true });
    expect(t.states().map((state) => state.why)).toEqual(['saver', 'permission']);
    expect(nth(t.states(), 1)).toMatchObject({ since: START + MINUTE });
    // The permission is given again; battery saver still holds: back to it, with a fresh start.
    await jest.advanceTimersByTimeAsync(MINUTE);
    await t.reporter.set({ permissionOff: false });
    expect(nth(t.states(), 2)).toMatchObject({ why: 'saver', since: START + 2 * MINUTE });
    t.reporter.reset();
  });

  it('does not flap: a reason that comes and goes within the gap is told once it settles', async () => {
    const t = setup(1);
    await t.located();
    await t.reporter.set({ saver: true });
    await jest.advanceTimersByTimeAsync(10_000);
    await t.reporter.set({ saver: false });
    // Not told yet: the circle heard from this phone a moment ago.
    expect(t.sent).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(STATE_GAP_MS - 10_000);
    expect(t.states().map((state) => state.why)).toEqual(['saver', 'none']);
    // On and off again within the gap: only where it ended up is said.
    await t.reporter.set({ saver: true });
    await t.reporter.set({ saver: false });
    await t.reporter.set({ saver: true });
    await jest.advanceTimersByTimeAsync(STATE_GAP_MS);
    expect(t.states().map((state) => state.why)).toEqual(['saver', 'none', 'saver']);
    t.reporter.reset();
  });

  it('says nothing for a phone no friend holds a location of (a permission never given)', async () => {
    const t = setup();
    await t.reporter.set({ permissionOff: true });
    await t.reporter.set({ saver: true });
    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    expect(t.sent).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('starts as soon as the first location is out, if the reason was there already', async () => {
    const t = setup(1);
    await t.reporter.set({ saver: true });
    expect(t.sent).toHaveLength(0);
    await t.located();
    expect(t.states().map((state) => state.why)).toEqual(['saver']);
    t.reporter.reset();
  });
});

describe('who is told', () => {
  it('nobody while a ghost, and nothing more once one starts (a frozen location stays as it was)', async () => {
    const t = setup(1);
    await t.located();
    await t.reporter.set({ saver: true });
    expect(t.sent).toHaveLength(1);
    t.share({ ...DEFAULT_SHARING, ghost: 'freeze' });
    await t.engine.changed();
    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    // No heartbeat, no clear when it ends: the friend's screen settles on "offline" by itself.
    await t.reporter.set({ saver: false });
    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    expect(t.sent).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sends nothing at all in ghost "hide", whatever the reason', async () => {
    const t = setup();
    await t.located();
    t.share({ ...DEFAULT_SHARING, ghost: 'hide' });
    await t.engine.changed();
    for (const signal of [{ saver: true }, { permissionOff: true }, { servicesOff: true }]) {
      await t.reporter.set(signal);
    }
    await jest.advanceTimersByTimeAsync(NOFIX_AFTER_MS + 10 * MINUTE);
    expect(t.sent).toHaveLength(0);
  });

  it('only the reason goes to a coarse circle: same message, no position, same size', async () => {
    const t = setup();
    const [exact, coarse] = [nth(t.circles, 0), nth(t.circles, 1)];
    t.share({
      ghost: 'off',
      circles: { [coarse.id]: { sharing: true, precision: 'neighborhood', until: null } },
    });
    await t.located();
    await t.reporter.set({ saver: true });
    expect(t.toCircles().sort()).toEqual([exact.id, coarse.id].sort());
    const [a, b] = t.states();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toMatch(/lat|lng|acc|spd|hdg|bat|chg/);
    t.reporter.reset();
  });

  it('nothing to a circle the location does not go to, and nothing when its share runs out', async () => {
    const t = setup(3);
    const [kept, off, timed] = [nth(t.circles, 0), nth(t.circles, 1), nth(t.circles, 2)];
    t.share({
      ghost: 'off',
      circles: {
        [off.id]: { sharing: false, precision: 'exact', until: null },
        [timed.id]: { sharing: true, precision: 'exact', until: START + 2 * MINUTE },
      },
    });
    await t.located();
    await t.reporter.set({ saver: true });
    expect(t.toCircles().sort()).toEqual([kept.id, timed.id].sort());
    // The heartbeat after the time is up goes to the circle still shared, only.
    await jest.advanceTimersByTimeAsync(HEARTBEAT);
    expect(t.toCircles(2)).toEqual([kept.id]);
    t.reporter.reset();
  });

  it('nothing to a paused circle (nobody keeps it open)', async () => {
    const t = setup(2);
    const paused = nth(t.circles, 1);
    t.circles[1] = { ...paused, paused: true };
    await t.located();
    await t.reporter.set({ saver: true });
    expect(t.toCircles()).toEqual([nth(t.circles, 0).id]);
    t.reporter.reset();
  });

  it('a circle that starts getting the location meanwhile is told the reason too', async () => {
    const t = setup(2);
    const [first, second] = [nth(t.circles, 0), nth(t.circles, 1)];
    t.share({
      ghost: 'off',
      circles: { [second.id]: { sharing: false, precision: 'exact', until: null } },
    });
    await t.located();
    await t.reporter.set({ saver: true });
    expect(t.toCircles()).toEqual([first.id]);
    await jest.advanceTimersByTimeAsync(MINUTE);
    t.share(DEFAULT_SHARING);
    await t.engine.changed();
    await settle();
    expect(t.toCircles(1)).toEqual([second.id]);
    t.reporter.reset();
  });
});

describe('the reasons', () => {
  it('weighs them: the permission first, then the services, battery saver, and silence', () => {
    const none = { permissionOff: false, servicesOff: false, saver: false };
    expect(reasonOf(none, 0)).toBeNull();
    expect(reasonOf(none, NOFIX_AFTER_MS - 1)).toBeNull();
    expect(reasonOf(none, NOFIX_AFTER_MS)).toEqual({ why: 'nofix', silent: true });
    expect(reasonOf({ ...none, saver: true }, NOFIX_AFTER_MS)).toEqual({
      why: 'saver',
      silent: false,
    });
    expect(reasonOf({ ...none, saver: true, servicesOff: true }, 0)).toEqual({
      why: 'nofix',
      silent: false,
    });
    expect(reasonOf({ saver: true, servicesOff: true, permissionOff: true }, 0)).toEqual({
      why: 'permission',
      silent: false,
    });
  });

  it('says "no position" after three minutes of nothing, since the last one, and clears on the next', async () => {
    const t = setup(1);
    await t.located();
    await jest.advanceTimersByTimeAsync(NOFIX_AFTER_MS - 1);
    expect(t.sent).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.sent).toHaveLength(1);
    expect(nth(t.states())).toMatchObject({ why: 'nofix', since: START });
    // A position comes in again: the reason ends at once (after the gap between messages).
    await jest.advanceTimersByTimeAsync(MINUTE);
    await t.engine.fix({ ...moved(GALATA, 300, Date.now()), ts: Date.now() });
    await settle();
    expect(t.states().map((state) => state.why)).toEqual(['nofix', 'none']);
    // And the silence starts again from that position.
    await jest.advanceTimersByTimeAsync(NOFIX_AFTER_MS);
    expect(t.states().map((state) => state.why)).toEqual(['nofix', 'none', 'nofix']);
    t.reporter.reset();
  });

  it('keeps silent while positions keep coming', async () => {
    const t = setup(1);
    await t.located();
    await t.healthy(20);
    expect(t.sent).toHaveLength(0);
    t.reporter.reset();
  });

  it('explains location services that are off at once, not after the silence', async () => {
    const t = setup(1);
    await t.located();
    await t.reporter.set({ servicesOff: true });
    expect(t.states().map((state) => state.why)).toEqual(['nofix']);
    t.reporter.reset();
  });
});

describe('when it does not get through', () => {
  it('tries again after a minute, and at once when the connection returns', async () => {
    const t = setup(1);
    await t.located();
    t.setReply(() => Promise.reject(new Error('offline')));
    await t.reporter.set({ saver: true });
    expect(t.sent).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(RETRY_MS - 1);
    expect(t.sent).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(t.sent).toHaveLength(2);
    // Back online before the next try: it goes now.
    t.setReply(() => Promise.resolve({ ok: true }));
    await t.reporter.flush();
    expect(t.sent).toHaveLength(3);
    // Told: the heartbeat counts from here.
    await jest.advanceTimersByTimeAsync(HEARTBEAT);
    expect(t.sent).toHaveLength(4);
    t.reporter.reset();
  });

  it('asks for the circle again when the relay says the epoch moved on, and tries later', async () => {
    const t = setup(1);
    await t.located();
    t.setReply(() => Promise.resolve<BumpReply>({ refused: 'EPOCH' }));
    await t.reporter.set({ saver: true });
    expect(t.outdated).toEqual([[nth(t.circles).id]]);
    t.setReply(() => Promise.resolve({ ok: true }));
    await jest.advanceTimersByTimeAsync(RETRY_MS);
    expect(t.sent).toHaveLength(2);
    t.reporter.reset();
  });
});

describe('what a state carries (privacy)', () => {
  it('has no position, accuracy, speed or battery in any message, and every one is the padded size', async () => {
    const t = setup(2);
    const coarse = nth(t.circles, 1);
    t.share({
      ghost: 'off',
      circles: { [coarse.id]: { sharing: true, precision: 'city', until: null } },
    });
    await t.located();
    // Every reason, a heartbeat, a clear: the whole life of a state.
    await t.reporter.set({ saver: true });
    await jest.advanceTimersByTimeAsync(HEARTBEAT);
    await t.reporter.set({ permissionOff: true });
    await jest.advanceTimersByTimeAsync(MINUTE);
    await t.reporter.set({ permissionOff: false, servicesOff: true });
    await jest.advanceTimersByTimeAsync(MINUTE);
    // A position came in meanwhile, so the silence does not take over from the reasons that end.
    await t.engine.fix({ ...moved(GALATA, 400, Date.now()), ts: Date.now() });
    await t.reporter.set({ servicesOff: false, saver: false });
    await jest.advanceTimersByTimeAsync(NOFIX_AFTER_MS + MINUTE);
    const states = t.states();
    expect(new Set(states.map((state) => state.why))).toEqual(
      new Set(['saver', 'permission', 'nofix', 'none']),
    );
    for (const state of states) {
      expect(Object.keys(state).sort()).toEqual(['kind', 'since', 'ts', 'why']);
    }
    const text = JSON.stringify(states);
    expect(text).not.toMatch(/lat|lng|acc|spd|hdg|bat|chg|eta/);
    expect(text).not.toContain(String(GALATA.lat).slice(0, 6));
    expect(text).not.toContain(String(GALATA.lng).slice(0, 6));
    // Nor does the wire: the envelope is ciphertext of one fixed size, and no push rides along.
    for (const request of t.sent) {
      expect(JSON.stringify(request)).not.toContain(String(GALATA.lat).slice(0, 6));
      expect(request.pushes).toEqual([]);
      expect(Math.ceil((request.envelope.ct.length * 3) / 4)).toBe(528);
    }
    t.reporter.reset();
  });
});

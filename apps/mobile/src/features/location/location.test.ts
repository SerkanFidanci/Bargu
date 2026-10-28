import { exportDeviceKeyBundle, randomUuid } from '@bargu/crypto';
import type { LocPayload } from '@bargu/schemas';

import { bestPerPerson, createReceiver, type ReceivedLocation, useLocations } from './receive';
import { buildEnvelopes, locPayload, SEND_RULES, shouldSend } from './send';
import {
  circleSharing,
  DEFAULT_SHARING,
  endOfDay,
  isSharingWith,
  needsGps,
  seenThere,
  seersByCircle,
  seersOf,
  sharedCircles,
  type SharingSettings,
  withAllShared,
  withMinorSharing,
  withNewCirclesOff,
  withNothingShared,
  withoutGoneCircles,
} from './sharing';
import {
  card,
  circleOf,
  exchangeKeys,
  GALATA,
  moved,
  nth,
  type Person,
  somebody,
} from './test-support';

const BATTERY = { level: 64, charging: false };
const DEFAULT_OFF = { sharing: false, precision: 'exact', until: null } as const;
const NOW = 1_800_000_000_000;

function settingsWith(
  circles: SharingSettings['circles'],
  ghost: SharingSettings['ghost'] = 'off',
) {
  return { ghost, circles };
}

describe('sharing settings', () => {
  const circleId = randomUuid();

  it('start with nothing shared on a new phone, keeping choices it already has', () => {
    const known = randomUuid();
    const fresh = withNothingShared(
      settingsWith({ [known]: { sharing: true, precision: 'city', until: null } }),
      [known, circleId],
    );
    expect(isSharingWith(fresh, circleId, NOW)).toBe(false);
    expect(fresh.circles[known]).toEqual({ sharing: true, precision: 'city', until: null });
    // "Share with all": every circle gets the exact location again.
    const all = withAllShared(fresh, [known, circleId]);
    expect(all.circles[circleId]).toEqual({ sharing: true, precision: 'exact', until: null });
    expect(all.circles[known]?.precision).toBe('exact');
  });

  it('starts a circle joined at 15–17 unshared, keeping the ones already shared (docs/ADR/0023)', () => {
    const before = randomUuid();
    const later = randomUuid();
    const teen = withNewCirclesOff(settingsWith({}), [before]);
    expect(isSharingWith(teen, before, NOW)).toBe(true);
    expect(isSharingWith(teen, later, NOW)).toBe(false);
    expect(teen.newCircles).toBe('off');
    // Done once: what the user chose afterwards is not touched again.
    const chosen = { ...teen, circles: { ...teen.circles, [before]: { ...DEFAULT_OFF } } };
    expect(withNewCirclesOff(chosen, [before, later])).toBe(chosen);
  });

  it('hides the speed at 15–17 unless the user chose to show it ("Hızımı gösterme")', () => {
    const teen = withMinorSharing(settingsWith({}), []);
    expect(teen.speed).toBe('hide');
    expect(teen.newCircles).toBe('off');
    const shown = { ...teen, speed: 'show' as const };
    expect(withMinorSharing(shown, [])).toBe(shown);
  });

  it('forgets the choices of circles left behind, so joining again starts with history off (Faz 9 W4)', () => {
    const gone = randomUuid();
    const settings = settingsWith({
      [gone]: { sharing: true, precision: 'exact', until: null, history: true },
      [circleId]: { sharing: false, precision: 'city', until: null },
    });
    const kept = withoutGoneCircles(settings, (id) => id === gone);
    expect(Object.keys(kept.circles)).toEqual([circleId]);
    expect(circleSharing(kept, gone).history).not.toBe(true);
    expect(kept.circles[circleId]).toEqual(settings.circles[circleId]);
  });

  it('shares with a joined circle by default, until a timed share runs out', () => {
    expect(isSharingWith(DEFAULT_SHARING, circleId, NOW)).toBe(true);
    const timed = settingsWith({
      [circleId]: { sharing: true, precision: 'exact', until: NOW + 1 },
    });
    expect(isSharingWith(timed, circleId, NOW)).toBe(true);
    expect(isSharingWith(timed, circleId, NOW + 1)).toBe(false);
  });

  it('shares with nobody while a ghost, whatever the circles say', () => {
    for (const ghost of ['freeze', 'hide'] as const) {
      expect(isSharingWith(settingsWith({}, ghost), circleId, NOW)).toBe(false);
    }
  });

  it('says a circle sees the history only while it is written: not while a ghost or paused (3a-B5)', () => {
    const on = { sharing: true, precision: 'exact', until: null, history: true } as const;
    expect(seenThere(settingsWith({ [circleId]: on }), circleId, NOW)).toEqual({
      location: true,
      history: true,
    });
    for (const ghost of ['freeze', 'hide'] as const) {
      expect(seenThere(settingsWith({ [circleId]: on }, ghost), circleId, NOW)).toEqual({
        location: false,
        history: false,
      });
    }
    const paused = settingsWith({ [circleId]: { ...on, sharing: false } });
    expect(seenThere(paused, circleId, NOW).history).toBe(false);
  });

  it('sends only to circles the user is active in', () => {
    const active = { id: randomUuid(), myStatus: 'active' as const };
    const invited = { id: randomUuid(), myStatus: 'invited' as const };
    expect(sharedCircles([active, invited], DEFAULT_SHARING, NOW)).toEqual([active]);
  });

  it('sends nothing to a circle nobody keeps open (docs/ADR/0024)', () => {
    const open = { id: randomUuid(), myStatus: 'active' as const };
    const paused = { id: randomUuid(), myStatus: 'active' as const, paused: true };
    expect(sharedCircles([open, paused], DEFAULT_SHARING, NOW)).toEqual([open]);
  });

  it('keeps GPS off when no circle gets the exact location', () => {
    const circle = { id: randomUuid(), myStatus: 'active' as const };
    const coarse = settingsWith({ [circle.id]: { sharing: true, precision: 'city', until: null } });
    expect(needsGps([circle], DEFAULT_SHARING, NOW)).toBe(true);
    expect(needsGps([circle], coarse, NOW)).toBe(false);
  });

  it('lists who sees me: active members of shared circles, not me and not the invited', () => {
    const [me, ada, bo, cem] = [somebody(), somebody(), somebody(), somebody()];
    const shared = circleOf([me, ada]);
    const notShared = circleOf([me, cem]);
    shared.members.push(card(bo, 'invited'));
    const settings = settingsWith({
      [notShared.id]: { sharing: false, precision: 'exact', until: null },
    });
    const seers = seersOf([shared, notShared], settings, me.userId, NOW);
    expect(seers.map((member) => member.userId)).toEqual([ada.userId]);
    expect(seersOf([shared], settingsWith({}, 'hide'), me.userId, NOW)).toEqual([]);
  });

  it('groups who sees me by circle, and nobody once all is stopped (Faz 9)', () => {
    const [me, ada, bo] = [somebody(), somebody(), somebody()];
    const family = circleOf([me, ada]);
    const team = circleOf([me, bo]);
    const alone = circleOf([me]);
    const groups = seersByCircle([family, team, alone], DEFAULT_SHARING, me.userId, NOW);
    expect(groups.map(({ circle, seers }) => [circle.id, seers.map((m) => m.userId)])).toEqual([
      [family.id, [ada.userId]],
      [team.id, [bo.userId]],
    ]);
    const stopped = { ...DEFAULT_SHARING, ghost: 'hide' as const };
    expect(seersByCircle([family, team], stopped, me.userId, NOW)).toEqual([]);
  });

  it('ends "until tonight" at the last millisecond of the local day', () => {
    const end = new Date(endOfDay(NOW));
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getTime()).toBeGreaterThan(NOW);
  });
});

describe('when a location is sent', () => {
  it('follows the frequency table: moving, still (heartbeat) and live', () => {
    expect(shouldSend(null, GALATA, NOW, false)).toBe(true);
    const last = { fix: GALATA, sentAt: NOW };
    const soon = NOW + SEND_RULES.movingIntervalMs;
    expect(shouldSend(last, moved(GALATA, 3, soon), soon, false)).toBe(false);
    expect(shouldSend(last, moved(GALATA, 15, soon - 1), soon - 1, false)).toBe(false);
    expect(shouldSend(last, moved(GALATA, 15, soon), soon, false)).toBe(true);
    const later = NOW + SEND_RULES.heartbeatMs;
    expect(shouldSend(last, GALATA, later, false)).toBe(true);
    const second = NOW + SEND_RULES.liveIntervalMs;
    expect(shouldSend(last, GALATA, second, true)).toBe(true);
    expect(shouldSend(last, GALATA, second - 1, true)).toBe(false);
  });

  it('sends at most once a minute while moving with the app closed, live still live (ADR 0036)', () => {
    const last = { fix: GALATA, sentAt: NOW };
    const soon = NOW + SEND_RULES.movingIntervalMs;
    expect(shouldSend(last, moved(GALATA, 15, soon), soon, false, true)).toBe(false);
    const minute = NOW + SEND_RULES.backgroundIntervalMs;
    expect(shouldSend(last, moved(GALATA, 15, minute - 1), minute - 1, false, true)).toBe(false);
    expect(shouldSend(last, moved(GALATA, 15, minute), minute, false, true)).toBe(true);
    // Someone looking: every second, closed app or not.
    expect(shouldSend(last, GALATA, NOW + SEND_RULES.liveIntervalMs, true, true)).toBe(true);
    // The numbers of the ADR.
    expect(SEND_RULES.backgroundIntervalMs).toBe(60_000);
    expect(SEND_RULES.heartbeatMs).toBe(5 * 60_000);
  });

  it('says since when it has stayed, never later than the fix itself', () => {
    expect(locPayload(GALATA, BATTERY, GALATA.ts - 5_000).since).toBe(GALATA.ts - 5_000);
    expect(locPayload(GALATA, BATTERY, GALATA.ts + 1).since).toBeUndefined();
    expect(locPayload(GALATA, BATTERY).since).toBeUndefined();
  });

  it('leaves out values the platform got wrong', () => {
    const payload = locPayload(
      { ...GALATA, acc: -1, spd: -1, hdg: 400 },
      { level: 140, charging: true },
    );
    expect(payload).toEqual({
      kind: 'loc',
      lat: GALATA.lat,
      lng: GALATA.lng,
      acc: 0,
      bat: 100,
      chg: true,
      ts: GALATA.ts,
    });
  });
});

describe('a location from one phone to another', () => {
  let alice: Person;
  let bob: Person;

  beforeEach(() => {
    alice = somebody();
    bob = somebody();
    useLocations.setState({}, true);
  });

  function receiverOf(person: Person, circles: () => ReturnType<typeof circleOf>[]) {
    return createReceiver({
      keys: () => person.keys,
      circles,
      store: () => person.store,
      now: () => NOW,
    });
  }

  function send(circles: ReturnType<typeof circleOf>[], settings = DEFAULT_SHARING, fix = GALATA) {
    return buildEnvelopes({
      fix,
      battery: BATTERY,
      circles,
      settings,
      keys: bob.keys,
      device: bob.device,
      now: NOW,
    });
  }

  it('arrives encrypted, opens on the other phone and shows on its map', () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    const envelope = nth(send([circle]));
    expect(JSON.stringify(envelope)).not.toContain(String(GALATA.lat));
    const receiver = receiverOf(alice, () => [circle]);
    expect(receiver.receive(envelope)).toBe('shown');
    const shown = useLocations.getState()[`${circle.id}:${bob.userId}`];
    expect(shown?.loc).toMatchObject({ lat: GALATA.lat, lng: GALATA.lng, bat: 64 });
    // The same envelope again (a replay by the server) changes nothing.
    expect(receiver.receive(envelope)).toBe('ignored');
  });

  it('is coarsened per circle before encryption', () => {
    const exact = circleOf([alice, bob]);
    const city = circleOf([alice, bob]);
    exchangeKeys(exact, [alice, bob]);
    exchangeKeys(city, [alice, bob]);
    const settings = settingsWith({ [city.id]: { sharing: true, precision: 'city', until: null } });
    const envelopes = send([exact, city], settings);
    expect(envelopes).toHaveLength(2);
    const receiver = receiverOf(alice, () => [exact, city]);
    for (const envelope of envelopes) receiver.receive(envelope);
    const state = useLocations.getState();
    const coarse = state[`${city.id}:${bob.userId}`]?.loc;
    expect(state[`${exact.id}:${bob.userId}`]?.loc.lat).toBe(GALATA.lat);
    expect(coarse?.lat).not.toBe(GALATA.lat);
    expect(coarse?.acc).toBeGreaterThanOrEqual(5_000);
    // On the map Bob is one person: the exact location wins.
    expect(bestPerPerson(state).map((entry) => entry.circleId)).toEqual([exact.id]);
  });

  it('never shows a location older than the one on the map (it arrived late)', () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    const receiver = receiverOf(alice, () => [circle]);
    const key = `${circle.id}:${bob.userId}`;
    // Sent in this order (numbered so), measured the other way round.
    const newer = nth(send([circle], DEFAULT_SHARING, moved(GALATA, 50, NOW - 1_000)));
    const older = nth(send([circle], DEFAULT_SHARING, moved(GALATA, 20, NOW - 3_000)));
    expect(receiver.receive(newer)).toBe('shown');
    expect(receiver.receive(older)).toBe('ignored');
    expect(useLocations.getState()[key]?.loc.ts).toBe(NOW - 1_000);
    // The same position again (a coarser precision for it) still replaces it.
    const coarse = settingsWith({ [circle.id]: { sharing: true, precision: 'city', until: null } });
    const again = nth(send([circle], coarse, moved(GALATA, 50, NOW - 1_000)));
    expect(receiver.receive(again)).toBe('shown');
    expect(useLocations.getState()[key]?.loc.acc).toBeGreaterThanOrEqual(5_000);
    // Hours "older": the sender's clock was put back, so it is shown.
    const reset = nth(send([circle], DEFAULT_SHARING, moved(GALATA, 10, NOW - 3 * 3_600_000)));
    expect(receiver.receive(reset)).toBe('shown');
  });

  it('numbers messages so none can be replayed, also across restarts', () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    const first = nth(send([circle]));
    const second = nth(send([circle], DEFAULT_SHARING, moved(GALATA, 50, 1)));
    expect(second.seq).toBe(first.seq + 1);
    receiverOf(alice, () => [circle]).receive(second);
    // A new run on the same phone: the older one is still refused.
    expect(receiverOf(alice, () => [circle]).receive(first)).toBe('ignored');
  });

  it('waits for a sender key that has not arrived, then shows it', () => {
    const circle = circleOf([alice, bob]);
    bob.keys.observe(circle);
    const envelope = nth(send([circle]));
    const receiver = receiverOf(alice, () => [circle]);
    expect(receiver.receive(envelope)).toBe('waiting');
    exchangeKeys(circle, [alice, bob]);
    receiver.retryWaiting();
    expect(useLocations.getState()[`${circle.id}:${bob.userId}`]).toBeDefined();
  });

  it('ignores a member whose identity key changed until the user accepts it', () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    const envelope = nth(send([circle]));
    // Bob's card now shows another identity key (a new phone, or an attack).
    const otherKey = exportDeviceKeyBundle(somebody().device).identityKey;
    const changed = {
      ...circle,
      members: circle.members.map((member) =>
        member.userId === bob.userId && member.device !== null
          ? {
              ...member,
              device: {
                ...member.device,
                bundle: { ...member.device.bundle, identityKey: otherKey },
              },
            }
          : member,
      ),
    };
    alice.keys.observe(changed);
    expect(receiverOf(alice, () => [changed]).receive(envelope)).toBe('ignored');
  });

  it('keeps the last locations on the phone for the next start, and drops what is gone', async () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    const envelope = nth(send([circle]));
    receiverOf(alice, () => [circle]).receive(envelope);
    useLocations.setState({}, true);

    const next = receiverOf(alice, () => [circle]);
    next.restore();
    expect(useLocations.getState()[`${circle.id}:${bob.userId}`]?.loc.lat).toBe(GALATA.lat);
    // The server still has it: the snapshot (already opened) keeps it on the map.
    await next.receiveSnapshot([envelope]);
    expect(Object.keys(useLocations.getState())).toHaveLength(1);
    // Expired or taken back on the server: gone here too.
    await next.receiveSnapshot([]);
    expect(useLocations.getState()).toEqual({});
  });

  it('keeps the speed on the phone when the user hides it, and sends the rest', () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    const receiver = receiverOf(alice, () => [circle]);
    receiver.receive(nth(send([circle])));
    expect(useLocations.getState()[`${circle.id}:${bob.userId}`]?.loc.spd).toBe(GALATA.spd);
    const hidden = { ...DEFAULT_SHARING, speed: 'hide' as const };
    receiver.receive(nth(send([circle], hidden, moved(GALATA, 50, 1))));
    const shown = useLocations.getState()[`${circle.id}:${bob.userId}`]?.loc;
    expect(shown?.spd).toBeUndefined();
    expect(shown?.hdg).toBe(GALATA.hdg);
    expect(shown?.lat).not.toBe(GALATA.lat);
  });

  it('drops a member who left from the map', () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    let circles = [circle];
    const receiver = receiverOf(alice, () => circles);
    receiver.receive(nth(send([circle])));
    circles = [{ ...circle, members: circle.members.filter((m) => m.userId !== bob.userId) }];
    receiver.prune();
    expect(useLocations.getState()).toEqual({});
  });

  it('shows nobody in a paused circle, and drops who was there (docs/ADR/0024)', () => {
    const circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    let circles = [circle];
    const receiver = receiverOf(alice, () => circles);
    const envelope = nth(send([circle]));
    expect(receiver.receive(envelope)).toBe('shown');
    circles = [{ ...circle, paused: true }];
    receiver.prune();
    expect(useLocations.getState()).toEqual({});
    // Bob's phone also sends nothing there now.
    expect(send(circles)).toEqual([]);
  });
});

describe('one dot per person', () => {
  const entry = (circleId: string, acc: number, ts: number): ReceivedLocation => ({
    circleId,
    userId: 'bob',
    loc: { kind: 'loc', lat: 41, lng: 29, acc, bat: 50, chg: false, ts } satisfies LocPayload,
    receivedAt: ts,
  });

  it('prefers the most precise recent location, else the newest', () => {
    expect(
      bestPerPerson({ a: entry('a', 5_000, 1_000), b: entry('b', 10, 2_000) })[0]?.circleId,
    ).toBe('b');
    expect(
      bestPerPerson({ a: entry('a', 5_000, 200_000), b: entry('b', 10, 1_000) })[0]?.circleId,
    ).toBe('a');
  });
});

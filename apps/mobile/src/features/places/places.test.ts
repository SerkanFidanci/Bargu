import type { Circle, MessageEnvelope, PlaceRecord } from '@bargu/schemas';

import {
  circleOf,
  exchangeKeys,
  memoryStore,
  nth,
  type Person,
  somebody,
} from '../location/test-support';
import { createPlaces, type PlacesApi, type Refusal, usePlaces } from './places';

class Refused extends Error {
  constructor(readonly code: Exclude<Refusal, null>) {
    super(code);
  }
}

/** The server as the phone sees it: compare-and-set on versions, current epoch only. */
function fakeServer(epochOf: (circleId: string) => number) {
  const rows = new Map<string, PlaceRecord>();
  const api: PlacesApi = {
    list: () => Promise.resolve([...rows.values()]),
    put: (circleId, placeId, envelope: MessageEnvelope, version) => {
      if (envelope.epoch !== epochOf(circleId)) return Promise.reject(new Refused('EPOCH_STALE'));
      const row = rows.get(placeId);
      if ((row?.version ?? null) !== version) {
        return Promise.reject(new Refused('VERSION_CONFLICT'));
      }
      const next = { circleId, id: placeId, version: (version ?? 0) + 1, envelope };
      rows.set(placeId, next);
      return Promise.resolve(next.version);
    },
    remove: (_circleId, placeId) => {
      rows.delete(placeId);
      return Promise.resolve();
    },
  };
  return { api, rows };
}

function placesOf(person: Person, circles: () => Circle[], api: PlacesApi) {
  return createPlaces({
    api,
    keys: () => person.keys,
    device: () => person.device,
    circles,
    store: () => person.store,
    refusal: (error) => (error instanceof Refused ? error.code : null),
    refreshCircle: () => Promise.resolve(null),
    now: () => 1_000,
  });
}

const draft = { name: 'Bizim ev', emoji: '🏠', lat: 41.0082, lng: 28.9784, radius: 250 };

beforeEach(() => {
  usePlaces.setState({}, true);
});

describe('places', () => {
  it("are sealed on the author's phone and opened on the others'", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);

    expect(await placesOf(ayse, () => [circle], server.api).save(circle.id, draft)).toBe('saved');
    const stored = nth([...server.rows.values()]);
    expect(JSON.stringify(stored)).not.toContain('Bizim ev');

    usePlaces.setState({}, true);
    await placesOf(bora, () => [circle], server.api).sync();
    expect(Object.values(usePlaces.getState())).toEqual([
      { ...draft, id: stored.id, circleId: circle.id, version: 1, ts: 1_000 },
    ]);
  });

  it('change only from the version read; a stale save asks to look again', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    const mine = placesOf(ayse, () => [circle], server.api);
    await mine.save(circle.id, draft);
    const id = nth(Object.keys(usePlaces.getState()));

    // Bora renames it meanwhile (his phone read version 1, so did Ayşe's).
    const held = usePlaces.getState();
    const boras = placesOf(bora, () => [circle], server.api);
    await boras.sync();
    expect(await boras.save(circle.id, { ...draft, id, name: 'Ev' })).toBe('saved');
    usePlaces.setState(held, true);
    expect(await mine.save(circle.id, { ...draft, id, name: 'Yuva' })).toBe('conflict');
    // The conflict brought Bora's version: the next change starts from it.
    expect(usePlaces.getState()[id]).toMatchObject({ name: 'Ev', version: 2 });
    expect(await mine.save(circle.id, { ...draft, id, name: 'Yuva' })).toBe('saved');
  });

  it('never go back to an older version, nor come back once deleted', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    const ayses = placesOf(ayse, () => [circle], server.api);
    await ayses.save(circle.id, draft);
    const id = nth(Object.keys(usePlaces.getState()));
    const old = nth([...server.rows.values()]);
    await ayses.save(circle.id, { ...draft, id, name: 'Yeni ev' });

    // The server serves the old message again, with a higher version: the name stays.
    server.rows.set(id, { ...old, version: 7 });
    await ayses.sync();
    expect(usePlaces.getState()[id]).toMatchObject({ name: 'Yeni ev', version: 7 });

    const place = usePlaces.getState()[id];
    if (place === undefined) throw new Error('missing');
    expect(await ayses.remove(place)).toBe(true);
    server.rows.set(id, old);
    await ayses.sync();
    expect(usePlaces.getState()).toEqual({});
  });

  it('are sealed again under a new epoch, so members who joined since can open them', async () => {
    const [ayse, bora, cem] = [somebody(), somebody(), somebody()];
    let circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    await placesOf(ayse, () => [circle], server.api).save(circle.id, draft);
    const id = nth(Object.keys(usePlaces.getState()));

    // Cem joins: a new epoch, keys of that epoch only for him.
    circle = { ...circleOf([ayse, bora, cem]), id: circle.id, epoch: 2 };
    exchangeKeys(circle, [ayse, bora, cem]);
    usePlaces.setState({}, true);
    const cems = placesOf(cem, () => [circle], server.api);
    await cems.sync();
    expect(usePlaces.getState()).toEqual({});

    // Bora's phone (it can open the old one) seals it again under epoch 2.
    usePlaces.setState({}, true);
    const boras = placesOf(bora, () => [circle], server.api);
    const stale = await boras.sync();
    expect(stale).toHaveLength(1);
    expect(await boras.reseal(stale)).toBe(1);
    expect(server.rows.get(id)?.envelope.epoch).toBe(2);

    usePlaces.setState({}, true);
    await cems.sync();
    expect(usePlaces.getState()[id]).toMatchObject({ name: 'Bizim ev', version: 2 });
  });

  it("ignore places whose author's identity changed until the user accepts it", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    await placesOf(ayse, () => [circle], server.api).save(circle.id, draft);

    // The server now claims Ayşe has another identity key.
    const impostor = somebody();
    const swapped = circleOf([{ ...impostor, userId: ayse.userId }, bora], {
      id: circle.id,
      epoch: circle.epoch,
    });
    bora.keys.observe(swapped);
    usePlaces.setState({}, true);
    await placesOf(bora, () => [swapped], server.api).sync();
    expect(usePlaces.getState()).toEqual({});
  });

  it('go with the circle when this phone leaves it', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    let circles = [circle];
    const ayses = placesOf(ayse, () => circles, server.api);
    await ayses.save(circle.id, draft);
    circles = [];
    ayses.prune();
    expect(usePlaces.getState()).toEqual({});
    expect(memoryStore().get('places:v1')).toBeUndefined();
  });
});

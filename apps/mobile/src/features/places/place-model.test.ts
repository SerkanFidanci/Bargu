import { distanceM } from '../location/send';
import {
  circleRing,
  metersPerPoint,
  nextPresence,
  placeAt,
  type Presence,
  snapRadius,
} from './place-model';

const home = { lat: 41.0082, lng: 28.9784, radius: 100 };
/** A position `meters` north of home's centre. */
const north = (meters: number, acc = 10, ts = 1) => ({
  lat: home.lat + meters / 111_320,
  lng: home.lng,
  acc,
  ts,
});

describe('arrivals and departures', () => {
  it('only records where the phone is the first time (no "arrived" for being there)', () => {
    expect(nextPresence(undefined, home, north(20))).toEqual({
      presence: { inside: true, since: 1 },
      event: null,
    });
    expect(nextPresence(undefined, home, north(500)).presence?.inside).toBe(false);
  });

  it('announces an arrival inside the circle and a departure only well past it', () => {
    const away: Presence = { inside: false, since: 0 };
    const arrived = nextPresence(away, home, north(90, 10, 5));
    expect(arrived).toEqual({ presence: { inside: true, since: 5 }, event: 'enter' });
    const there = arrived.presence;
    // On the edge, a little outside, wobbling: still there.
    expect(nextPresence(there, home, north(115)).event).toBeNull();
    expect(nextPresence(there, home, north(140, 30)).event).toBeNull();
    // Clearly gone: past radius + margin even counting the accuracy.
    expect(nextPresence(there, home, north(200, 20, 9))).toEqual({
      presence: { inside: false, since: 9 },
      event: 'exit',
    });
  });

  it('ignores positions vaguer than the place', () => {
    const away: Presence = { inside: false, since: 0 };
    expect(nextPresence(away, home, north(0, 400))).toEqual({ presence: away, event: null });
  });
});

describe('places on the map', () => {
  it('snaps a dragged size to 100, 250 or 500 m', () => {
    expect(snapRadius(40)).toBe(100);
    expect(snapRadius(170)).toBe(100);
    expect(snapRadius(180)).toBe(250);
    expect(snapRadius(380)).toBe(500);
    expect(snapRadius(5_000)).toBe(500);
  });

  it('converts metres to screen points like MapLibre (half as many per zoom step)', () => {
    expect(metersPerPoint(0, 0)).toBeCloseTo(78_271.5, 0);
    expect(metersPerPoint(15, 41)).toBeCloseTo(metersPerPoint(14, 41) / 2, 6);
  });

  it('puts someone at the smallest place around them', () => {
    const district = { lat: home.lat, lng: home.lng, radius: 500, id: 'district' };
    const house = { ...home, id: 'house' };
    expect(placeAt([district, house], north(50))?.id).toBe('house');
    expect(placeAt([district, house], north(300))?.id).toBe('district');
    expect(placeAt([district, house], north(900))).toBeNull();
  });

  it('draws the circle as a closed ring at the right distance', () => {
    const ring = circleRing(home, 250, 12);
    expect(ring).toHaveLength(13);
    expect(ring[0]).toEqual(ring[12]);
    for (const [lng, lat] of ring) {
      expect(distanceM(home, { lat, lng })).toBeCloseTo(250, 0);
    }
  });
});

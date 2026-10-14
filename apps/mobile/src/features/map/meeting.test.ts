import { project } from './glide';
import { MEET_M, meetings } from './meeting';

const HERE = { lat: 41.0256, lng: 28.9742, acc: 8 };
const at = (metres: number, acc = 8) => ({ ...project(HERE, 90, metres), acc });

describe('meeting up', () => {
  it('celebrates once when a friend comes within 50 m, again only after they part', () => {
    const near = { userId: 'ada', at: at(MEET_M - 10), exact: true };
    const first = meetings({ me: HERE, others: [near], now: 1 }, {});
    expect(first.met).toEqual(['ada']);
    // Still together a bit farther away: no second celebration.
    const still = meetings(
      { me: HERE, others: [{ ...near, at: at(120) }], now: 2 },
      first.together,
    );
    expect(still.met).toEqual([]);
    expect(Object.keys(still.together)).toEqual(['ada']);
    // Parted, then met again: a new one.
    const parted = meetings(
      { me: HERE, others: [{ ...near, at: at(400) }], now: 3 },
      still.together,
    );
    expect(parted.together).toEqual({});
    expect(meetings({ me: HERE, others: [near], now: 4 }, parted.together).met).toEqual(['ada']);
  });

  it('never through a coarse location or when this phone shares less than exact', () => {
    const coarse = { userId: 'ada', at: at(10, 1_000), exact: true };
    expect(meetings({ me: HERE, others: [coarse], now: 1 }, {}).met).toEqual([]);
    const notExact = { userId: 'ada', at: at(10), exact: false };
    expect(meetings({ me: HERE, others: [notExact], now: 1 }, {}).met).toEqual([]);
    expect(meetings({ me: null, others: [{ ...notExact, exact: true }], now: 1 }, {}).met).toEqual(
      [],
    );
  });
});

import { ago, placeIn } from './runs';

const ALI = 'ali';
const AYSE = 'ayse';
// Noon, so a few minutes either way stay on the same day.
const NOON = new Date(2026, 9, 28, 12, 0).getTime();
const MIN = 60_000;

describe('runs and times in a conversation (the owner, 2026-10-28)', () => {
  it('reads one sender close together as one run, the time only above the first', () => {
    const one = { from: ALI, at: NOON };
    const two = { from: ALI, at: NOON + MIN };
    const three = { from: ALI, at: NOON + 2 * MIN };
    expect(placeIn(one, undefined, two)).toEqual({ first: true, last: false, stamp: true });
    expect(placeIn(two, one, three)).toEqual({ first: false, last: false, stamp: false });
    expect(placeIn(three, two, undefined)).toEqual({ first: false, last: true, stamp: false });
  });

  it('starts a new run with another sender or after a short pause, a time after a long one', () => {
    const ali = { from: ALI, at: NOON };
    const ayse = { from: AYSE, at: NOON + MIN };
    const aliLater = { from: ALI, at: NOON + 10 * MIN };
    const aliMuchLater = { from: ALI, at: NOON + 40 * MIN };
    expect(placeIn(ali, undefined, ayse).last).toBe(true);
    expect(placeIn(ayse, ali, aliLater)).toEqual({ first: true, last: true, stamp: false });
    expect(placeIn(aliLater, { from: ALI, at: NOON + 4 * MIN }, undefined)).toEqual({
      first: true,
      last: true,
      stamp: false,
    });
    expect(placeIn(aliMuchLater, aliLater, undefined).stamp).toBe(true);
  });

  it('shows the time on a new day, even within a minute', () => {
    const late = { from: ALI, at: new Date(2026, 9, 27, 23, 59).getTime() };
    const early = { from: ALI, at: new Date(2026, 9, 28, 0, 0, 30).getTime() };
    expect(placeIn(early, late, undefined)).toEqual({ first: true, last: true, stamp: true });
    expect(placeIn(late, undefined, early).last).toBe(true);
  });

  it('says how long ago in the list: now, minutes, hours', () => {
    expect(ago(NOON, NOON + 30_000)).toEqual({ key: 'now' });
    expect(ago(NOON, NOON + 5 * MIN)).toEqual({ key: 'minutes', count: 5 });
    expect(ago(NOON, NOON + 59 * MIN)).toEqual({ key: 'minutes', count: 59 });
    expect(ago(NOON, NOON + 3 * 60 * MIN + 10 * MIN)).toEqual({ key: 'hours', count: 3 });
    // A clock a little behind the sender's: never "in the future".
    expect(ago(NOON + MIN, NOON)).toEqual({ key: 'now' });
  });
});

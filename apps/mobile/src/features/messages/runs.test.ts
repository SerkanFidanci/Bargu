import { placeIn } from './runs';

const ALI = 'ali';
const AYSE = 'ayse';
// Noon, so a few minutes either way stay on the same day.
const NOON = new Date(2026, 9, 28, 12, 0).getTime();
const MIN = 60_000;

describe('runs and days in a conversation (the owner, 2026-10-28)', () => {
  it('reads one sender close together as one run: a name on the first, a time on the last', () => {
    const one = { from: ALI, at: NOON };
    const two = { from: ALI, at: NOON + MIN };
    const three = { from: ALI, at: NOON + 2 * MIN };
    expect(placeIn(one, undefined, two)).toEqual({ first: true, last: false, newDay: true });
    expect(placeIn(two, one, three)).toEqual({ first: false, last: false, newDay: false });
    expect(placeIn(three, two, undefined)).toEqual({ first: false, last: true, newDay: false });
  });

  it('starts a new run with another sender, or after a pause', () => {
    const ali = { from: ALI, at: NOON };
    const ayse = { from: AYSE, at: NOON + MIN };
    const aliLater = { from: ALI, at: NOON + 20 * MIN };
    expect(placeIn(ali, undefined, ayse).last).toBe(true);
    expect(placeIn(ayse, ali, aliLater)).toEqual({ first: true, last: true, newDay: false });
    expect(placeIn(aliLater, ayse, undefined).first).toBe(true);
    expect(placeIn(aliLater, { from: ALI, at: NOON + 10 * MIN }, undefined).first).toBe(true);
  });

  it('starts a new day after midnight, even within a run', () => {
    const late = { from: ALI, at: new Date(2026, 9, 27, 23, 59).getTime() };
    const early = { from: ALI, at: new Date(2026, 9, 28, 0, 1).getTime() };
    expect(placeIn(early, late, undefined)).toEqual({ first: true, last: true, newDay: true });
    expect(placeIn(late, undefined, early).last).toBe(true);
  });
});

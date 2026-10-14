import { nextStay } from '../location/stay';
import { activityOf } from './activity';
import { project } from './glide';

const HERE = { lat: 41.0256, lng: 28.9742 };

describe('what someone is doing', () => {
  it('is read from their speed, the same on every phone', () => {
    expect(activityOf(0.3, 0)).toBe('still');
    expect(activityOf(1.4, 0)).toBe('walking');
    expect(activityOf(3, 0)).toBe('running');
    expect(activityOf(6, 0)).toBe('cycling');
    expect(activityOf(20, 0)).toBe('driving');
    // Coarse locations carry no speed and no stay: nothing is guessed.
    expect(activityOf(undefined, 0)).toBe('still');
  });

  it('is "settled" after 30 minutes within 100 m', () => {
    expect(activityOf(0, 29 * 60_000)).toBe('still');
    expect(activityOf(0, 30 * 60_000)).toBe('settled');
    // Moving wins over having been somewhere for long.
    expect(activityOf(1.4, 3 * 3_600_000)).toBe('walking');
  });

  it('keeps the stay while within 100 m and restarts it farther away', () => {
    const first = nextStay(null, HERE, 1_000);
    expect(nextStay(first, project(HERE, 0, 60), 2_000)).toBe(first);
    expect(nextStay(first, project(HERE, 0, 150), 3_000)).toMatchObject({ since: 3_000 });
  });
});

import { fuller, nameStays, type StayPoint } from './stay-names';

const home: StayPoint = { from: 1, lat: 40.99, lng: 29.02 };
const work: StayPoint = { from: 2, lat: 41.04, lng: 29.0 };

describe('names for the stays of a day (the owner, 2026-10-28)', () => {
  it('keeps the fuller name, and never loses one to a look that found none', () => {
    expect(fuller(undefined, null)).toBeUndefined();
    expect(fuller(undefined, 'Kadıköy')).toBe('Kadıköy');
    expect(fuller('Kadıköy', 'Caferağa, Kadıköy')).toBe('Caferağa, Kadıköy');
    expect(fuller('Caferağa, Kadıköy', 'Kadıköy')).toBe('Caferağa, Kadıköy');
    expect(fuller('Caferağa, Kadıköy', null)).toBe('Caferağa, Kadıköy');
  });

  it('names each stay from the map around it, keeping what an earlier look found', async () => {
    const zoomedOut = await nameStays([home, work], {}, (stay) =>
      Promise.resolve(stay === home ? 'Kadıköy' : null),
    );
    expect(zoomedOut).toEqual({ 1: 'Kadıköy' });

    // A closer look: the neighbourhood too, and the other stay at last; a failed lookup is no name.
    const closer = await nameStays([home, work], zoomedOut, (stay) =>
      stay === home ? Promise.resolve('Caferağa, Kadıköy') : Promise.reject(new Error('gone')),
    );
    expect(closer).toEqual({ 1: 'Caferağa, Kadıköy' });
    const last = await nameStays([home, work], closer, (stay) =>
      Promise.resolve(stay === home ? 'Kadıköy' : 'Şişli'),
    );
    expect(last).toEqual({ 1: 'Caferağa, Kadıköy', 2: 'Şişli' });
  });
});

import type { Circle, LocPayload } from '@bargu/schemas';

import { useMyFix } from '../location/engine';
import { meetings } from '../location/location-session';
import { useLocations } from '../location/receive';
import { docKey, useDocs } from './docs';
import { type Meeting, useArrived, useLates } from './meeting';
import { type Arrival, answersOf, arrivals, starterOf } from './plan-model';

/**
 * Who is where for a meeting, from what this phone already holds (the meeting's board and the
 * map's chip, one source for both): the circle's active members' last locations, what they said
 * ("late", "Geldim", outside an event their answer), and this phone's own position with its
 * estimate (docs/ADR/0026 §5, Ek 2).
 */
export function useArrivals(circle: Circle, meeting: Meeting, me: string, now: number): Arrival[] {
  const locations = useLocations();
  const lates = useLates();
  const said = useArrived();
  const docs = useDocs();
  const myFix = useMyFix((state) => state.fix);
  const mySince = useMyFix((state) => state.since);
  const active = circle.members.filter((member) => member.status === 'active');
  const located: Record<string, LocPayload | undefined> = {};
  const told: Record<string, number | undefined> = {};
  const arrived = new Set<string>();
  for (const member of active) {
    located[member.userId] = locations[`${circle.id}:${member.userId}`]?.loc;
    const late = lates[`${circle.id}:${member.userId}`];
    if (late?.meetAt === meeting.meetAt) told[member.userId] = late.minutes;
    if (said[`${circle.id}:${member.userId}`]?.meetAt === meeting.meetAt) {
      arrived.add(member.userId);
    }
  }
  if (myFix !== null) {
    const eta = meetings.eta(circle.id, myFix, now);
    located[me] = {
      kind: 'loc',
      lat: myFix.lat,
      lng: myFix.lng,
      acc: myFix.acc,
      bat: 100,
      chg: false,
      ts: myFix.ts,
      // Standing or moving, as for everyone else (Ö12).
      ...(myFix.spd === null ? {} : { spd: myFix.spd }),
      ...(mySince === null ? {} : { since: mySince }),
      ...(eta === undefined ? {} : { eta }),
    };
  }
  return arrivals({
    meetAt: meeting.meetAt,
    place: meeting.place,
    members: active.map((member) => member.userId),
    locations: located,
    told,
    arrived,
    ...(circle.kind === 'event'
      ? {}
      : {
          answers: answersOf(docs, circle.id),
          starter: starterOf(docs[docKey(circle.id, circle.id)]),
        }),
    now,
  });
}

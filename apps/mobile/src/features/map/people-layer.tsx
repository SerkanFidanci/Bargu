import type { Circle, Me, MemberCard } from '@bargu/schemas';

import { memberName } from '../circles/names';
import { useNow } from '../location/clock';
import { useMyFix } from '../location/engine';
import { bestPerPerson, useLocations } from '../location/receive';
import { usePokes } from '../social/poke';
import { GlidingMarker } from './gliding-marker';
import { MapAvatar } from './map-avatar';
import type { PersonHandlers } from './person-gestures';

/**
 * A location older than this is shown grey with its age. A still phone sends a heartbeat every
 * 5 minutes (send.ts), so two missed ones mean the phone is off, offline or out of reach.
 */
export const STALE_AFTER_MS = 10 * 60_000;
/** Below this (%) and not charging, the battery shows as nearly empty (BARGU_PLAN §4.3). */
export const LOW_BATTERY = 15;

/** Minutes since a location was taken, when old enough to say so. */
export function staleMinutes(ts: number, now: number): number | undefined {
  const age = now - ts;
  return age < STALE_AFTER_MS ? undefined : Math.floor(age / 60_000);
}

function cardOf(circles: readonly Circle[], userId: string): MemberCard | undefined {
  for (const circle of circles) {
    const member = circle.members.find((candidate) => candidate.userId === userId);
    if (member !== undefined) return member;
  }
  return undefined;
}

/**
 * Everyone on the map: one avatar per person (their most precise recent location over all shared
 * circles), and the user's own avatar at the phone's position. Avatars glide between locations
 * (gliding-marker.tsx) and show without text whether someone moves, charges or runs out of battery.
 */
export function PeopleLayer({
  me,
  circles,
  handlersFor,
}: {
  me: Me;
  circles: readonly Circle[];
  /** Tap and hold on someone (card, radial menu). */
  handlersFor?: (userId: string) => PersonHandlers;
}) {
  const locations = useLocations();
  const pokes = usePokes();
  const myFix = useMyFix((state) => state.fix);
  const now = useNow();
  return (
    <>
      {bestPerPerson(locations).map((entry) => {
        const card = cardOf(circles, entry.userId);
        if (card === undefined) return null;
        const { loc } = entry;
        return (
          <GlidingMarker
            key={entry.userId}
            id={entry.userId}
            fix={loc}
            receivedAt={entry.receivedAt}
          >
            <MapAvatar
              name={memberName(card)}
              avatar={card.avatar}
              staleMinutes={staleMinutes(loc.ts, now)}
              spd={loc.spd}
              hdg={loc.hdg}
              charging={loc.chg}
              lowBattery={!loc.chg && loc.bat < LOW_BATTERY}
              handlers={handlersFor?.(entry.userId)}
              pokedAt={pokes[entry.userId]}
            />
          </GlidingMarker>
        );
      })}
      {myFix === null ? null : (
        <GlidingMarker id="me" fix={myFix} receivedAt={myFix.ts}>
          <MapAvatar
            name={me.displayName ?? '?'}
            avatar={me.avatar}
            spd={myFix.spd}
            hdg={myFix.hdg}
          />
        </GlidingMarker>
      )}
    </>
  );
}

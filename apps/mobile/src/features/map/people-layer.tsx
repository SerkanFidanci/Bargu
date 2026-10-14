import type { Circle, Me, MemberCard } from '@bargu/schemas';
import { useMemo } from 'react';

import { memberName } from '../circles/names';
import { useNow } from '../location/clock';
import { useMyFix } from '../location/engine';
import { bestPerPerson, type ReceivedLocation, useLocations } from '../location/receive';
import { usePokes } from '../social/poke';
import { statusOf, useMyStatus, useStatuses } from '../social/status';
import { StatusBubble } from '../social/status-sheet';
import { GlidingMarker } from './gliding-marker';
import { MapAvatar } from './map-avatar';
import type { PersonHandlers } from './person-gestures';
import { useMeetingWatcher } from './use-meetings';
import { type Cluster, clusterPeople } from './cluster';
import { useMapZoom } from './map-zoom';
import { ClusterBubble } from './cluster-bubble';

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
  onCluster,
}: {
  me: Me;
  circles: readonly Circle[];
  /** Tap and hold on someone (card, radial menu). */
  handlersFor?: (userId: string) => PersonHandlers;
  /** A tap on a cluster of people (the map zooms in). */
  onCluster?: (lat: number, lng: number) => void;
}) {
  const locations = useLocations();
  const pokes = usePokes();
  const statuses = useStatuses();
  const myStatus = useMyStatus((state) => state.status);
  const burst = useMeetingWatcher(me, circles);
  const myFix = useMyFix((state) => state.fix);
  const now = useNow();
  const zoom = useMapZoom((state) => state.zoom);
  const people = bestPerPerson(locations).flatMap((entry) => {
    const card = cardOf(circles, entry.userId);
    return card === undefined
      ? []
      : [{ id: entry.userId, lat: entry.loc.lat, lng: entry.loc.lng, entry, card }];
  });
  const clusters = clusterPeople(people, zoom);
  return (
    <>
      {clusters.map((cluster) => {
        if (cluster.members.length > 1) {
          return (
            <ClusterMarker key={cluster.key} cluster={cluster} now={now} onPress={onCluster} />
          );
        }
        const [person] = cluster.members;
        if (person === undefined) return null;
        const { entry, card } = person;
        const { loc } = entry;
        const status = statusOf(statuses, entry.userId, now);
        return (
          <GlidingMarker
            key={entry.userId}
            id={entry.userId}
            fix={loc}
            receivedAt={entry.receivedAt}
          >
            <MapAvatar
              userId={entry.userId}
              name={memberName(card)}
              avatar={card.avatar}
              staleMinutes={staleMinutes(loc.ts, now)}
              spd={loc.spd}
              hdg={loc.hdg}
              charging={loc.chg}
              lowBattery={!loc.chg && loc.bat < LOW_BATTERY}
              handlers={handlersFor?.(entry.userId)}
              pokedAt={pokes[entry.userId]}
              above={status === null ? undefined : <StatusBubble status={status} />}
            />
          </GlidingMarker>
        );
      })}
      {myFix === null ? null : (
        <GlidingMarker id="me" fix={myFix} receivedAt={myFix.ts}>
          <MapAvatar
            userId={me.userId}
            name={me.displayName ?? '?'}
            avatar={me.avatar}
            spd={myFix.spd}
            hdg={myFix.hdg}
            burst={burst}
            above={
              myStatus === null || myStatus.expiresAt <= now ? undefined : (
                <StatusBubble status={myStatus} />
              )
            }
          />
        </GlidingMarker>
      )}
    </>
  );
}

interface PersonOnMap {
  id: string;
  lat: number;
  lng: number;
  entry: ReceivedLocation;
  card: MemberCard;
}

/** Several people merged into one liquid bubble at their centre; a tap zooms in on them. */
function ClusterMarker({
  cluster,
  now,
  onPress,
}: {
  cluster: Cluster<PersonOnMap>;
  now: number;
  onPress: ((lat: number, lng: number) => void) | undefined;
}) {
  const newest = Math.max(...cluster.members.map((member) => member.entry.loc.ts));
  // A new object only when the centre moves, so the marker glides instead of restarting.
  const fix = useMemo(
    () => ({ lat: cluster.lat, lng: cluster.lng, ts: newest }),
    [cluster.lat, cluster.lng, newest],
  );
  return (
    <GlidingMarker id={cluster.key} fix={fix} receivedAt={now}>
      <ClusterBubble
        people={cluster.members.map((member) => ({
          id: member.id,
          name: memberName(member.card),
          avatar: member.card.avatar,
        }))}
        offsets={cluster.offsets}
        onPress={() => onPress?.(cluster.lat, cluster.lng)}
      />
    </GlidingMarker>
  );
}

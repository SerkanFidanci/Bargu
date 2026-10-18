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
import { type Cluster, capsuleOf, clusterPeople } from './cluster';
import { UncertaintyLayer } from './uncertainty-layer';
import { useMapZoom } from './map-zoom';
import { activityOf } from './activity';
import { motionDetail } from './motion-detail';
import { ClusterBubble, type TogetherPerson } from './cluster-bubble';
import type { ScreenPoint } from './person-focus';
import type { GroupMember } from './together-sheet';

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

/** Someone on the map: a member at their best location, or the user at the phone's position. */
type PersonOnMap = { id: string; lat: number; lng: number } & (
  | { kind: 'member'; entry: ReceivedLocation; card: MemberCard }
  | { kind: 'me'; ts: number; acc: number }
);

/**
 * Everyone on the map: one sticker per person (their most precise recent location over all shared
 * circles), and the user's own at the phone's position. Stickers glide between locations
 * (gliding-marker.tsx) and show without text whether someone moves, charges or runs out of battery.
 * People who would overlap, the user included, stand together side by side above one island
 * (cluster-bubble.tsx; proje sahibi 2026-10-16: the user's avatar sat on top of a friend's).
 */
export function PeopleLayer({
  me,
  circles,
  handlersFor,
  onGroup,
}: {
  me: Me;
  circles: readonly Circle[];
  /** Tap and hold on someone (card, radial menu). */
  handlersFor?: (userId: string) => PersonHandlers;
  /** A tap on a frame of more than two people standing together: everyone there. */
  onGroup?: (people: GroupMember[], from: ScreenPoint) => void;
}) {
  const locations = useLocations();
  const pokes = usePokes();
  const statuses = useStatuses();
  const myStatus = useMyStatus((state) => state.status);
  const burst = useMeetingWatcher(me, circles);
  const myFix = useMyFix((state) => state.fix);
  const now = useNow();
  const zoom = useMapZoom((state) => state.zoom);
  const mySince = useMyFix((state) => state.since);
  const members: PersonOnMap[] = bestPerPerson(locations).flatMap((entry) => {
    const card = cardOf(circles, entry.userId);
    return card === undefined
      ? []
      : [
          {
            kind: 'member' as const,
            id: entry.userId,
            lat: entry.loc.lat,
            lng: entry.loc.lng,
            entry,
            card,
          },
        ];
  });
  const people: PersonOnMap[] =
    myFix === null
      ? members
      : [
          ...members,
          {
            kind: 'me',
            id: me.userId,
            lat: myFix.lat,
            lng: myFix.lng,
            ts: myFix.ts,
            acc: myFix.acc,
          },
        ];
  const clusters = clusterPeople(people, zoom);

  /** A person's sticker as drawn on its own or side by side with others. */
  const together = (person: PersonOnMap): TogetherPerson => {
    if (person.kind === 'me') {
      return {
        id: person.id,
        marker: {
          userId: me.userId,
          activity:
            myFix === null
              ? undefined
              : activityOf(myFix.spd, mySince === null ? 0 : myFix.ts - mySince),
          name: me.displayName ?? '?',
          avatar: me.avatar,
          heading: myFix?.hdg,
        },
        above:
          myStatus === null || myStatus.expiresAt <= now ? undefined : (
            <StatusBubble status={myStatus} />
          ),
      };
    }
    const { entry, card } = person;
    const { loc } = entry;
    const status = statusOf(statuses, entry.userId, now);
    return {
      id: person.id,
      marker: {
        userId: entry.userId,
        activity: activityOf(loc.spd, loc.since === undefined ? 0 : loc.ts - loc.since),
        detail: motionDetail(loc, now),
        name: memberName(card),
        avatar: card.avatar,
        staleMinutes: staleMinutes(loc.ts, now),
        heading: loc.hdg,
        charging: loc.chg,
        lowBattery: !loc.chg && loc.bat < LOW_BATTERY,
      },
      handlers: handlersFor?.(entry.userId),
      pokedAt: pokes[entry.userId],
      above: status === null ? undefined : <StatusBubble status={status} />,
    };
  };

  return (
    <>
      <UncertaintyLayer
        spots={people.map((person) => ({
          id: person.id,
          lat: person.lat,
          lng: person.lng,
          acc: person.kind === 'me' ? person.acc : person.entry.loc.acc,
        }))}
      />
      {clusters.map((cluster) => {
        if (cluster.members.length > 1) {
          return (
            <TogetherMarker
              key={cluster.key}
              cluster={cluster}
              meId={me.userId}
              burst={burst}
              together={together}
              onGroup={onGroup}
            />
          );
        }
        const [person] = cluster.members;
        if (person === undefined) return null;
        const shown = together(person);
        if (person.kind === 'me') {
          if (myFix === null) return null;
          return (
            <GlidingMarker key="me" id="me" fix={myFix}>
              <MapAvatar
                {...shown.marker}
                spd={myFix.spd}
                hdg={myFix.hdg}
                news={myFix.ts}
                burst={burst}
                above={shown.above}
              />
            </GlidingMarker>
          );
        }
        const { loc } = person.entry;
        return (
          <GlidingMarker key={person.id} id={person.id} fix={loc}>
            <MapAvatar
              {...shown.marker}
              spd={loc.spd}
              hdg={loc.hdg}
              news={person.entry.receivedAt}
              handlers={shown.handlers}
              pokedAt={shown.pokedAt}
              above={shown.above}
            />
          </GlidingMarker>
        );
      })}
    </>
  );
}

/** People standing together: one row of stickers above one island at their centre. */
function TogetherMarker({
  cluster,
  meId,
  burst,
  together,
  onGroup,
}: {
  cluster: Cluster<PersonOnMap>;
  meId: string;
  burst: { at: number; colors: readonly [string, string] } | null;
  together: (person: PersonOnMap) => TogetherPerson;
  onGroup: ((people: GroupMember[], from: ScreenPoint) => void) | undefined;
}) {
  const newest = Math.max(
    ...cluster.members.map((member) => (member.kind === 'me' ? member.ts : member.entry.loc.ts)),
  );
  // A new object only when the centre moves, so the marker glides instead of restarting.
  const fix = useMemo(
    () => ({ lat: cluster.lat, lng: cluster.lng, ts: newest }),
    [cluster.lat, cluster.lng, newest],
  );
  const capsule = capsuleOf(cluster.members, meId);
  const withMe = capsule.shown.some(({ member }) => member.kind === 'me');
  // Everyone here for the window: the user first, the others in the cluster's order.
  const listed: GroupMember[] = [...cluster.members]
    .sort((a, b) => (a.kind === 'me' ? -1 : b.kind === 'me' ? 1 : 0))
    .map((member) => {
      const { marker } = together(member);
      return {
        userId: member.id,
        name: marker.name,
        avatar: marker.avatar,
        me: member.kind === 'me',
        staleMinutes: marker.staleMinutes,
        activity: marker.activity,
        detail: marker.detail,
      };
    });
  return (
    <GlidingMarker id={cluster.key} fix={fix}>
      <ClusterBubble
        people={capsule.shown.map(({ member }) => together(member))}
        more={capsule.more}
        offsets={capsule.shown.map(({ index }) => cluster.offsets[index] ?? { x: 0, y: 0 })}
        everyone={listed.map((member) => member.name)}
        burst={withMe ? burst : null}
        onList={(from) => onGroup?.(listed, from)}
      />
    </GlidingMarker>
  );
}

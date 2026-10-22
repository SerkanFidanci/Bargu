import type { DepartedPerson } from '../circles/circle-sync';
import { forgetLookOf } from '../cosmetics/look-session';
import { useHistoryPings } from '../history/history-api';
import { forgetViewer } from '../history/viewers';
import { forgetBundlesOf } from '../keys/bundle-cache';
import type { KeyStore } from '../keys/key-store';
import { loadMuteSettings, updateMutes } from '../notifications/mute-session';
import { withPersonMuted } from '../notifications/mutes';
import { useArrived, useLates } from '../plan/meeting';
import { forgetPhotoOf } from '../profile/photo';
import { forgetPokesOf } from '../social/poke';
import { forgetSafeOf } from '../social/safe';
import { forgetSpotsOf } from '../social/safe-spot';
import { forgetStatusesOf } from '../social/status';
import type { KeyValueStore } from '../storage/vault';
import type { Receiver } from './receive';
import { forgetMember } from './seen-by';

export interface PersonForgetterDeps {
  receiver: Pick<Receiver, 'forgetPerson'>;
  keys: () => KeyStore;
  store: () => KeyValueStore;
  now?: () => number;
}

/** Entries of a per-person map whose key says this person (`${circleId}:${userId}`). */
function withoutPerson<T>(held: Readonly<Record<string, T>>, userId: string): Record<string, T> {
  return Object.fromEntries(Object.entries(held).filter(([key]) => !key.endsWith(`:${userId}`)));
}

/**
 * THE place where a person is forgotten: called (through circle-sync, `departed`) when this phone's
 * last shared circle with them is gone, and never while one remains. Everything local about them is
 * deleted, so that leaving a circle leaves no trace of the person on the other phone:
 *
 *  - their photo and look, last locations, statuses and the reason a location is old ("Neden eski?");
 *  - the places of their "Güvendeyim" messages and the memory of which were shown;
 *  - their sender keys and history keys, the replay windows of their devices, messages that waited
 *    for their key, and their checked bundles in memory (the history itself is never kept here);
 *  - what this phone remembered about them: when they poked, were late or arrived, that they were
 *    known as someone who sees this phone, and the notification switches set for them;
 *
 * The record of who they were met with (`KeyStore.knownPeople`) goes in circle-sync, once all of
 * this succeeded: until then it is what makes the next change of the circle list try again.
 *
 * NOT the trust record (`KeyStore.identity`: their public identity key, whether it was compared in
 * person, whether it changed). It stays on purpose: it is what notices a changed key if the same
 * person is met again; without it a swapped key would pass as "first use". It holds no name and no
 * content, only a public-key fingerprint (docs/PROTOCOL.md). Sign-out and account deletion do wipe
 * it (the whole vault goes).
 *
 * Every step runs even if another fails; then it throws, and circle-sync asks again at the next
 * change of the circle list.
 */
export function forgetPerson(deps: PersonForgetterDeps, who: DepartedPerson): void {
  const { receiver, keys, store } = deps;
  const { userId } = who;
  const devices = new Set(who.deviceIds);
  const now = (deps.now ?? Date.now)();
  const steps: (() => void)[] = [
    () => {
      receiver.forgetPerson(userId, devices);
    },
    () => {
      forgetStatusesOf(userId);
    },
    () => {
      forgetPhotoOf(userId);
    },
    () => {
      forgetLookOf(userId);
    },
    () => {
      forgetSpotsOf(store(), userId, now);
    },
    () => {
      forgetSafeOf(store(), userId);
    },
    () => {
      keys().forgetDevices(devices);
    },
    () => {
      forgetBundlesOf(devices);
    },
    () => {
      forgetPokesOf(userId);
      useLates.setState(withoutPerson(useLates.getState(), userId), true);
      useArrived.setState(withoutPerson(useArrived.getState(), userId), true);
      useHistoryPings.setState(withoutPerson(useHistoryPings.getState(), userId), true);
    },
    () => {
      forgetMember(store(), userId);
      forgetViewer(store(), userId);
    },
    () => {
      if (userId in loadMuteSettings().people) {
        updateMutes((current) => withPersonMuted(current, userId, { places: false, pokes: false }));
      }
    },
  ];
  let failed = false;
  for (const step of steps) {
    try {
      step();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('a person could not be forgotten completely');
}

/** The listener circle-sync's `departed` calls: forgets each person (location-session wires it). */
export function forgetDeparted(
  deps: PersonForgetterDeps,
): (people: readonly DepartedPerson[]) => void {
  return (people) => {
    let failed = false;
    for (const person of people) {
      try {
        forgetPerson(deps, person);
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error('some people could not be forgotten completely');
  };
}

import { decryptStoredMessage, type DeviceKeys, encryptMessage, randomUuid } from '@bargu/crypto';
import {
  type Circle,
  type MessageEnvelope,
  type PlacePayload,
  type PlaceRecord,
  placeRecordSchema,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import { verifiedBundle } from '../keys/bundle-cache';
import type { KeyStore } from '../keys/key-store';
import { timed } from '../location/probe';
import type { KeyValueStore } from '../storage/vault';
import type { Place } from './place-model';

/** The circles' places this phone could open, by id (screens and the location engine read it). */
export const usePlaces = create<Record<string, Place>>(() => ({}));

/** Decrypted places, kept in the encrypted vault so a background start has them too. */
const CACHE_KEY = 'places:v1';
/** Deleted places and the last version seen: a server serving one again is not believed. */
const TOMBS_KEY = 'places:tombs:v1';

const placeSchema = z
  .object({
    id: z.string(),
    circleId: z.string(),
    version: z.number(),
    name: z.string(),
    emoji: z.string(),
    lat: z.number(),
    lng: z.number(),
    radius: z.number(),
    ts: z.number(),
  })
  .strict();
const tombsSchema = z.record(z.string(), z.number());

export interface PlaceDraft {
  /** Missing for a new place. */
  id?: string;
  name: string;
  emoji: string;
  lat: number;
  lng: number;
  radius: number;
}

export type SaveResult = 'saved' | 'conflict' | 'full' | 'failed';

function toPlace(payload: PlacePayload, circleId: string, version: number): Place {
  const { id, name, emoji, lat, lng, radius, ts } = payload;
  return { id, circleId, version, name, emoji, lat, lng, radius, ts };
}

function toPayload(place: Place): PlacePayload {
  const { id, name, emoji, lat, lng, radius, ts } = place;
  return { kind: 'place', id, name, emoji, lat, lng, radius, ts };
}

export interface PlacesApi {
  list: () => Promise<PlaceRecord[]>;
  /** Resolves with the new version; rejects with the API error code on refusal. */
  put: (
    circleId: string,
    placeId: string,
    envelope: MessageEnvelope,
    version: number | null,
  ) => Promise<number>;
  remove: (circleId: string, placeId: string) => Promise<void>;
}

/** Why the server refused a save, from the API error (null: some other failure). */
export type Refusal = 'VERSION_CONFLICT' | 'EPOCH_STALE' | 'PLACES_FULL' | null;

export interface PlacesDeps {
  api: PlacesApi;
  keys: () => KeyStore;
  device: () => DeviceKeys | null;
  circles: () => readonly Circle[];
  store: () => KeyValueStore;
  refusal: (error: unknown) => Refusal;
  /** The circle changed epoch (or membership) since it was cached: fetch it again. */
  refreshCircle: (circleId: string) => Promise<Circle | null>;
  now?: () => number;
}

/**
 * A circle's places (docs/ADR/0015). Each is stored on the server as the encrypted `place` message
 * of the member who last saved it; this phone opens them with that member's sender key and keeps
 * the plaintext only in its vault. A place sealed under an older epoch is sealed again under this
 * phone's current key, so members who joined since can open it too. Versions never go back: a
 * place whose `ts` is older than the one held, or that was deleted, is not taken from the server.
 */
export function createPlaces(deps: PlacesDeps) {
  const now = deps.now ?? Date.now;
  let restored = false;

  function restore(): void {
    if (restored) return;
    restored = true;
    const raw = deps.store().get(CACHE_KEY);
    const parsed = z.array(placeSchema).safeParse(raw === undefined ? [] : JSON.parse(raw));
    if (parsed.success) {
      usePlaces.setState(Object.fromEntries(parsed.data.map((place) => [place.id, place])), true);
    }
  }

  function tombs(): Record<string, number> {
    const raw = deps.store().get(TOMBS_KEY);
    const parsed = tombsSchema.safeParse(raw === undefined ? {} : JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  }

  function replace(next: Record<string, Place>): void {
    usePlaces.setState(next, true);
    deps.store().set(CACHE_KEY, JSON.stringify(Object.values(next)));
  }

  /** Opens a record with its author's key; null when it cannot (yet) be trusted or opened. */
  function open(record: PlaceRecord, circle: Circle): PlacePayload | null {
    const { envelope } = record;
    const keys = deps.keys();
    const device = deps.device();
    if (device === null) return null;
    let sender;
    let senderKey;
    if (envelope.senderDeviceId === device.deviceId) {
      sender = keys.ownPublicKeys();
      senderKey = keys.storedOwnKey(circle.id, envelope.epoch);
    } else {
      const author = circle.members.find(
        (member) => member.device?.bundle.deviceId === envelope.senderDeviceId,
      );
      const card = author?.device;
      if (author === undefined || card === undefined || card === null || !keys.trusted(author)) {
        return null;
      }
      sender = verifiedBundle(card.bundle);
      senderKey = keys.receivedKey(circle.id, envelope.epoch, envelope.senderDeviceId);
    }
    if (senderKey === null) return null;
    try {
      const payload = decryptStoredMessage({ envelope, senderKey, sender });
      return payload.id === record.id ? payload : null;
    } catch {
      return null;
    }
  }

  function seal(circle: Circle, payload: PlacePayload, device: DeviceKeys): MessageEnvelope {
    const keys = deps.keys();
    return encryptMessage({
      state: { senderKey: keys.ownKey(circle), nextSeq: keys.reserveSeq(circle) },
      sender: device,
      payload,
    }).envelope;
  }

  /** Records from the server, everything the caller can see: what is gone from it goes here too. */
  function apply(records: readonly PlaceRecord[]): PlaceRecord[] {
    restore();
    const circles = deps.circles().filter((circle) => circle.myStatus === 'active');
    const current = usePlaces.getState();
    const deleted = tombs();
    const next: Record<string, Place> = {};
    const stale: PlaceRecord[] = [];
    for (const raw of records) {
      const parsed = placeRecordSchema.safeParse(raw);
      if (!parsed.success) continue;
      const record = parsed.data;
      const circle = circles.find((candidate) => candidate.id === record.circleId);
      if (circle === undefined) continue;
      const held = current[record.id];
      const payload = open(record, circle);
      if (payload === null) {
        // Not openable yet (its author's key is on its way): keep what this phone had.
        if (held?.circleId === record.circleId)
          next[record.id] = { ...held, version: record.version };
        continue;
      }
      const tomb = deleted[record.id];
      if (tomb !== undefined && payload.ts <= tomb) continue;
      next[record.id] =
        held?.circleId === record.circleId && held.ts > payload.ts
          ? { ...held, version: record.version }
          : toPlace(payload, record.circleId, record.version);
      if (record.envelope.epoch < circle.epoch) stale.push(record);
    }
    replace(next);
    return stale;
  }

  async function sync(): Promise<PlaceRecord[]> {
    const records = await deps.api.list();
    return timed('places.apply', () => apply(records));
  }

  return {
    restore,

    /** Fetches every place again (after connecting, or when a circle's places changed). */
    sync,

    /**
     * Seals places of an older epoch again under this phone's current key (compare-and-set: if
     * someone else already did, nothing happens). Returns how many it saved.
     */
    async reseal(stale: readonly PlaceRecord[]): Promise<number> {
      const device = deps.device();
      if (device === null) return 0;
      let saved = 0;
      for (const record of stale) {
        const circle = deps.circles().find((candidate) => candidate.id === record.circleId);
        const place = usePlaces.getState()[record.id];
        if (circle === undefined || place === undefined) continue;
        try {
          const version = await deps.api.put(
            circle.id,
            place.id,
            seal(circle, toPayload(place), device),
            record.version,
          );
          usePlaces.setState({ [place.id]: { ...place, version } });
          saved += 1;
        } catch {
          // Someone else was faster, or the epoch moved on again: the next sync decides.
        }
      }
      if (saved > 0) replace(usePlaces.getState());
      return saved;
    },

    /** Saves a new or changed place for a circle (sealed on this phone, then sent). */
    async save(circleId: string, draft: PlaceDraft, retried = false): Promise<SaveResult> {
      restore();
      const device = deps.device();
      const circle = deps.circles().find((candidate) => candidate.id === circleId);
      if (device === null || circle?.myStatus !== 'active') return 'failed';
      const held = draft.id === undefined ? undefined : usePlaces.getState()[draft.id];
      const payload: PlacePayload = {
        kind: 'place',
        id: draft.id ?? randomUuid(),
        name: draft.name,
        emoji: draft.emoji,
        lat: draft.lat,
        lng: draft.lng,
        radius: draft.radius,
        // Only ever forward, whatever the clocks say (places.ts header).
        ts: Math.max(now(), (held?.ts ?? 0) + 1),
      };
      try {
        const version = await deps.api.put(
          circleId,
          payload.id,
          seal(circle, payload, device),
          held?.version ?? null,
        );
        replace({ ...usePlaces.getState(), [payload.id]: toPlace(payload, circleId, version) });
        return 'saved';
      } catch (error) {
        const refusal = deps.refusal(error);
        if (refusal === 'PLACES_FULL') return 'full';
        if (refusal === 'VERSION_CONFLICT') {
          await sync().catch(() => undefined);
          return 'conflict';
        }
        if (refusal === 'EPOCH_STALE' && !retried) {
          await deps.refreshCircle(circleId);
          return this.save(circleId, draft, true);
        }
        return 'failed';
      }
    },

    async remove(place: Place): Promise<boolean> {
      try {
        await deps.api.remove(place.circleId, place.id);
      } catch {
        return false;
      }
      deps.store().set(TOMBS_KEY, JSON.stringify({ ...tombs(), [place.id]: place.ts }));
      replace(
        Object.fromEntries(Object.entries(usePlaces.getState()).filter(([id]) => id !== place.id)),
      );
      return true;
    },

    /** Places of circles this phone is no longer active in go (left, removed, circle ended). */
    prune(): void {
      restore();
      const active = new Set(
        deps
          .circles()
          .filter((circle) => circle.myStatus === 'active')
          .map((circle) => circle.id),
      );
      const current = usePlaces.getState();
      const kept = Object.fromEntries(
        Object.entries(current).filter(([, place]) => active.has(place.circleId)),
      );
      if (Object.keys(kept).length !== Object.keys(current).length) replace(kept);
    },

    reset(): void {
      restored = false;
      usePlaces.setState({}, true);
    },
  };
}

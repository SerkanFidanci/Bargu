import {
  decryptDocument,
  type DeviceKeys,
  encryptDocument,
  verifyDeviceKeyBundle,
  voteId,
} from '@bargu/crypto';
import {
  type Circle,
  type DocPayload,
  docPayloadSchema,
  type DocRecord,
  docRecordSchema,
  type MessageEnvelope,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyStore } from '../keys/key-store';
import type { KeyValueStore } from '../storage/vault';
import type { Doc } from './plan-model';

/** Every event's documents this phone could open, keyed by `docKey` (screens read this). */
export const useDocs = create<Record<string, Doc>>(() => ({}));

export const docKey = (circleId: string, id: string) => `${circleId}:${id}`;

/** Opened documents, kept in the encrypted vault so a background start has the meetings too. */
const CACHE_KEY = 'docs:v1';
/** Deleted documents and their last `ts`: a server serving one again is not believed. */
const TOMBS_KEY = 'docs:tombs:v1';

const docSchema = z
  .object({
    circleId: z.string(),
    version: z.number(),
    shared: z.boolean(),
    authorId: z.string(),
    payload: docPayloadSchema,
  })
  .strict();
const tombsSchema = z.record(z.string(), z.number());

export interface DocsApi {
  list: (circleId: string) => Promise<DocRecord[]>;
  /** Resolves with the new version; rejects with the API error on refusal. */
  put: (
    circleId: string,
    docId: string,
    envelope: MessageEnvelope,
    version: number | null,
    shared: boolean,
  ) => Promise<number>;
  remove: (circleId: string, docId: string) => Promise<void>;
}

/** Why the server refused a save, from the API error (null: some other failure). */
export type DocRefusal = 'VERSION_CONFLICT' | 'EPOCH_STALE' | 'DOCS_FULL' | null;
export type DocSaveResult = 'saved' | 'conflict' | 'full' | 'failed';

export interface DocsDeps {
  api: DocsApi;
  keys: () => KeyStore;
  device: () => DeviceKeys | null;
  userId: () => string | null;
  circles: () => readonly Circle[];
  store: () => KeyValueStore;
  refusal: (error: unknown) => DocRefusal;
  /** The circle changed epoch (or membership) since it was cached: fetch it again. */
  refreshCircle: (circleId: string) => Promise<Circle | null>;
  now?: () => number;
}

/** A record of an older epoch this phone may seal again (shared ones, and its own). */
export interface StaleDoc {
  circleId: string;
  id: string;
  version: number;
}

/**
 * Whether a document is filed where it says: its own id, the meeting under the event's id and
 * shared, polls shared, and a vote under its voter's id for that poll (so nobody files a vote
 * under someone else, and each member has one vote per poll).
 */
function fits(payload: DocPayload, record: DocRecord, authorId: string): boolean {
  if (payload.id !== record.id) return false;
  if (payload.kind === 'plan') return record.shared && payload.id === record.circleId;
  if (payload.kind === 'poll') return record.shared;
  return !record.shared && payload.id === voteId(payload.pollId, authorId);
}

const activeEvents = (circles: readonly Circle[]) =>
  circles.filter((circle) => circle.kind === 'event' && circle.myStatus === 'active');

/**
 * The documents of event circles (docs/ADR/0018): the meeting, polls and votes. Like places
 * (places.ts): each is stored on the server as the encrypted document of the member who last saved
 * it, opened here with that member's sender key, kept in plaintext only in the vault, sealed again
 * under a newer epoch by any member when shared (by its author when not), never taken back to an
 * older `ts` and never back once deleted.
 */
export function createDocs(deps: DocsDeps) {
  const now = deps.now ?? Date.now;
  let restored = false;

  function restore(): void {
    if (restored) return;
    restored = true;
    const raw = deps.store().get(CACHE_KEY);
    const parsed = z.array(docSchema).safeParse(raw === undefined ? [] : JSON.parse(raw));
    if (parsed.success) {
      useDocs.setState(
        Object.fromEntries(parsed.data.map((doc) => [docKey(doc.circleId, doc.payload.id), doc])),
        true,
      );
    }
  }

  function tombs(): Record<string, number> {
    const raw = deps.store().get(TOMBS_KEY);
    const parsed = tombsSchema.safeParse(raw === undefined ? {} : JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  }

  function replace(next: Record<string, Doc>): void {
    useDocs.setState(next, true);
    deps.store().set(CACHE_KEY, JSON.stringify(Object.values(next)));
  }

  /** Opens a record with its author's key: null when it cannot (yet) be trusted or opened. */
  function open(record: DocRecord, circle: Circle): Doc | null {
    const { envelope } = record;
    const keys = deps.keys();
    const device = deps.device();
    const me = deps.userId();
    if (device === null || me === null) return null;
    let sender;
    let senderKey;
    let authorId;
    if (envelope.senderDeviceId === device.deviceId) {
      sender = keys.ownPublicKeys();
      senderKey = keys.storedOwnKey(circle.id, envelope.epoch);
      authorId = me;
    } else {
      const author = circle.members.find(
        (member) =>
          member.status === 'active' && member.device?.bundle.deviceId === envelope.senderDeviceId,
      );
      const card = author?.device;
      if (author === undefined || card === undefined || card === null || !keys.trusted(author)) {
        return null;
      }
      sender = verifyDeviceKeyBundle(card.bundle);
      senderKey = keys.receivedKey(circle.id, envelope.epoch, envelope.senderDeviceId);
      authorId = author.userId;
    }
    if (senderKey === null) return null;
    try {
      const payload = decryptDocument({ envelope, senderKey, sender });
      if (!fits(payload, record, authorId)) return null;
      return {
        circleId: circle.id,
        version: record.version,
        shared: record.shared,
        authorId,
        payload,
      };
    } catch {
      return null;
    }
  }

  function seal(circle: Circle, payload: DocPayload, device: DeviceKeys): MessageEnvelope {
    const keys = deps.keys();
    return encryptDocument({
      state: { senderKey: keys.ownKey(circle), nextSeq: keys.reserveSeq(circle) },
      sender: device,
      payload,
    }).envelope;
  }

  /**
   * One event's records from the server, all of them: what is gone from it goes here too. Returns
   * the records to seal again, and this phone's votes whose poll is gone (to delete).
   */
  function apply(
    circle: Circle,
    records: readonly DocRecord[],
  ): { stale: StaleDoc[]; orphans: string[] } {
    restore();
    const me = deps.userId();
    const current = useDocs.getState();
    const deleted = tombs();
    const next: Record<string, Doc> = Object.fromEntries(
      Object.entries(current).filter(([, doc]) => doc.circleId !== circle.id),
    );
    const stale: StaleDoc[] = [];
    const ids = new Set<string>();
    for (const raw of records) {
      const parsed = docRecordSchema.safeParse(raw);
      if (!parsed.success || parsed.data.circleId !== circle.id) continue;
      const record = parsed.data;
      ids.add(record.id);
      const key = docKey(circle.id, record.id);
      const held = current[key];
      const opened = open(record, circle);
      if (opened === null) {
        // Not openable yet (its author's key is on its way): keep what this phone had.
        if (held !== undefined) next[key] = { ...held, version: record.version };
        continue;
      }
      const tomb = deleted[key];
      if (tomb !== undefined && opened.payload.ts <= tomb) continue;
      next[key] =
        held !== undefined && held.payload.ts > opened.payload.ts
          ? { ...held, version: record.version }
          : opened;
      const mine = opened.authorId === me;
      if (record.envelope.epoch < circle.epoch && (record.shared || mine)) {
        stale.push({ circleId: circle.id, id: record.id, version: record.version });
      }
    }
    const orphans = Object.values(next)
      .filter(
        (doc) =>
          doc.circleId === circle.id &&
          doc.authorId === me &&
          doc.payload.kind === 'vote' &&
          !ids.has(doc.payload.pollId),
      )
      .map((doc) => doc.payload.id);
    replace(next);
    return { stale, orphans };
  }

  async function syncCircle(circle: Circle): Promise<{ stale: StaleDoc[]; orphans: string[] }> {
    return apply(circle, await deps.api.list(circle.id));
  }

  return {
    restore,

    /**
     * Fetches the documents of one event, or of every event this phone is in, again. Returns the
     * records of an older epoch this phone may seal again; deletes its votes in polls that are
     * gone.
     */
    async sync(circleId?: string): Promise<StaleDoc[]> {
      const events = activeEvents(deps.circles()).filter(
        (circle) => circleId === undefined || circle.id === circleId,
      );
      const stale: StaleDoc[] = [];
      for (const circle of events) {
        const result = await syncCircle(circle);
        stale.push(...result.stale);
        for (const id of result.orphans) {
          await deps.api.remove(circle.id, id).catch(() => undefined);
        }
      }
      return stale;
    },

    /** Seals documents of an older epoch again (compare-and-set). Returns how many it saved. */
    async reseal(stale: readonly StaleDoc[]): Promise<number> {
      const device = deps.device();
      if (device === null) return 0;
      let saved = 0;
      for (const record of stale) {
        const circle = deps.circles().find((candidate) => candidate.id === record.circleId);
        const doc = useDocs.getState()[docKey(record.circleId, record.id)];
        if (circle === undefined || doc === undefined) continue;
        try {
          const version = await deps.api.put(
            circle.id,
            record.id,
            seal(circle, doc.payload, device),
            record.version,
            doc.shared,
          );
          useDocs.setState({ [docKey(circle.id, record.id)]: { ...doc, version } });
          saved += 1;
        } catch {
          // Someone else was faster, or the epoch moved on again: the next sync decides.
        }
      }
      if (saved > 0) replace(useDocs.getState());
      return saved;
    },

    /**
     * Saves a document of an event (sealed on this phone, then sent): its `ts` only moves forward,
     * whatever the clocks say. Votes are this member's own; the meeting and polls are shared.
     */
    async save(circleId: string, draft: DocPayload, retried = false): Promise<DocSaveResult> {
      restore();
      const device = deps.device();
      const me = deps.userId();
      const circle = activeEvents(deps.circles()).find((candidate) => candidate.id === circleId);
      if (device === null || me === null || circle === undefined) return 'failed';
      const key = docKey(circleId, draft.id);
      const held = useDocs.getState()[key];
      const payload: DocPayload = { ...draft, ts: Math.max(now(), (held?.payload.ts ?? 0) + 1) };
      const shared = payload.kind !== 'vote';
      try {
        const version = await deps.api.put(
          circleId,
          payload.id,
          seal(circle, payload, device),
          held?.version ?? null,
          shared,
        );
        replace({
          ...useDocs.getState(),
          [key]: { circleId, version, shared, authorId: me, payload },
        });
        return 'saved';
      } catch (error) {
        const refusal = deps.refusal(error);
        if (refusal === 'DOCS_FULL') return 'full';
        if (refusal === 'VERSION_CONFLICT') {
          await syncCircle(circle).catch(() => undefined);
          return 'conflict';
        }
        if (refusal === 'EPOCH_STALE' && !retried) {
          await deps.refreshCircle(circleId);
          return this.save(circleId, draft, true);
        }
        return 'failed';
      }
    },

    /** Deletes a document (a poll: the event's owner or whoever started it). */
    async remove(circleId: string, id: string): Promise<boolean> {
      const key = docKey(circleId, id);
      const held = useDocs.getState()[key];
      try {
        await deps.api.remove(circleId, id);
      } catch {
        return false;
      }
      deps.store().set(TOMBS_KEY, JSON.stringify({ ...tombs(), [key]: held?.payload.ts ?? now() }));
      replace(Object.fromEntries(Object.entries(useDocs.getState()).filter(([k]) => k !== key)));
      return true;
    },

    /** Documents of events this phone is no longer in (left, removed, ended) go. */
    prune(): void {
      restore();
      const active = new Set(activeEvents(deps.circles()).map((circle) => circle.id));
      const current = useDocs.getState();
      const kept = Object.fromEntries(
        Object.entries(current).filter(([, doc]) => active.has(doc.circleId)),
      );
      if (Object.keys(kept).length !== Object.keys(current).length) replace(kept);
    },

    reset(): void {
      restored = false;
      useDocs.setState({}, true);
    },
  };
}

export type Docs = ReturnType<typeof createDocs>;

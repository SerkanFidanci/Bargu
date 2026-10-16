import {
  decryptDocument,
  type DeviceKeys,
  encryptDocument,
  verifyDeviceKeyBundle,
  voteId,
} from '@bargu/crypto';
import {
  type Circle,
  type DevicePushes,
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
import { type Doc, meetingEnd } from './plan-model';

/** Every circle's documents this phone could open, keyed by `docKey` (screens read this). */
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

/** What a meeting outside an event sends along (docs/ADR/0026): its end, notices when it starts. */
export interface DocExtra {
  endsAt?: number | undefined;
  pushes?: DevicePushes | undefined;
}

export interface DocsApi {
  list: (circleId: string) => Promise<DocRecord[]>;
  /** Resolves with the new version; rejects with the API error on refusal. */
  put: (
    circleId: string,
    docId: string,
    envelope: MessageEnvelope,
    version: number | null,
    kind: DocPayload['kind'],
    /** A vote's poll (the server files it there); null for anything else. */
    pollId: string | null,
    extra?: DocExtra,
  ) => Promise<number>;
  remove: (circleId: string, docId: string) => Promise<void>;
}

/** Why the server refused a save, from the API error (null: some other failure). */
export type DocRefusal =
  'VERSION_CONFLICT' | 'EPOCH_STALE' | 'DOCS_FULL' | 'FORBIDDEN' | 'MEETING_EXISTS' | null;
export type DocSaveResult = 'saved' | 'conflict' | 'full' | 'forbidden' | 'exists' | 'failed';

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
  /** Someone else just started a meeting outside an event (docs/ADR/0026 §6): say so in the app. */
  onMeetingStarted?: (circle: Circle, doc: Doc) => void;
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

const pollOf = (payload: DocPayload): string | null =>
  payload.kind === 'vote' ? payload.pollId : null;

/** Circles with documents: events (meeting, polls, votes), and any other's meeting (ADR 0026). */
const activeCircles = (circles: readonly Circle[]) =>
  circles.filter((circle) => circle.myStatus === 'active');

/**
 * Who may seal a shared document again under a newer epoch: an event's admins (docs/ADR/0020);
 * outside an event also the meeting's starter (docs/ADR/0026). One's own (a vote) its author.
 */
function mayReseal(circle: Circle, doc: Doc, me: string | null): boolean {
  if (!doc.shared) return doc.authorId === me;
  if (circle.myRole === 'owner') return true;
  return circle.kind !== 'event' && doc.payload.kind === 'plan' && doc.payload.by === me;
}

/** What a save sends along: outside an event the meeting says its end (docs/ADR/0026 §2). */
function extraOf(circle: Circle, payload: DocPayload): DocExtra | null {
  if (circle.kind === 'event') return {};
  const endsAt = payload.kind === 'plan' ? meetingEnd(payload) : null;
  return endsAt === null ? null : { endsAt };
}

/**
 * The documents of circles (docs/ADR/0018, 0026): an event's meeting, polls and votes, any other
 * circle's meeting. Like places
 * (places.ts): each is stored on the server as the encrypted document of the member who last saved
 * it, opened here with that member's sender key, kept in plaintext only in the vault, sealed again
 * under a newer epoch by an admin when shared (by its author when not), never taken back to an
 * older `ts` and never back once deleted.
 */
export function createDocs(deps: DocsDeps) {
  const now = deps.now ?? Date.now;
  let restored = false;
  /** Circles fetched at least once in this run (a meeting seen then was not just started). */
  const synced = new Set<string>();

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
    // A first look after a start says nothing new: what was there is not "just started".
    const restoredBefore = synced.has(circle.id);
    synced.add(circle.id);
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
      // Someone else's meeting just started in a circle that is no event: the app says so.
      if (
        held === undefined &&
        restoredBefore &&
        circle.kind !== 'event' &&
        opened.payload.kind === 'plan' &&
        opened.payload.by !== me
      ) {
        deps.onMeetingStarted?.(circle, opened);
      }
      if (record.envelope.epoch < circle.epoch && mayReseal(circle, opened, me)) {
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
      const events = activeCircles(deps.circles()).filter(
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
        const extra = extraOf(circle, doc.payload);
        if (extra === null) continue;
        try {
          const version = await deps.api.put(
            circle.id,
            record.id,
            seal(circle, doc.payload, device),
            record.version,
            doc.payload.kind,
            pollOf(doc.payload),
            extra,
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
     * Saves a document (sealed on this phone, then sent): its `ts` only moves forward, whatever
     * the clocks say. Votes are this member's own; the meeting and polls are shared. Outside an
     * event only the meeting, with its end; `pushes` tell the others when it starts.
     */
    async save(
      circleId: string,
      draft: DocPayload,
      options: { pushes?: DevicePushes; retried?: boolean } = {},
    ): Promise<DocSaveResult> {
      restore();
      const device = deps.device();
      const me = deps.userId();
      const circle = activeCircles(deps.circles()).find((candidate) => candidate.id === circleId);
      if (device === null || me === null || circle === undefined) return 'failed';
      const key = docKey(circleId, draft.id);
      const held = useDocs.getState()[key];
      const payload: DocPayload = { ...draft, ts: Math.max(now(), (held?.payload.ts ?? 0) + 1) };
      const shared = payload.kind !== 'vote';
      if (circle.kind !== 'event' && payload.kind !== 'plan') return 'forbidden';
      const extra = extraOf(circle, payload);
      if (extra === null) return 'failed';
      if (held === undefined && options.pushes !== undefined) extra.pushes = options.pushes;
      try {
        const version = await deps.api.put(
          circleId,
          payload.id,
          seal(circle, payload, device),
          held?.version ?? null,
          payload.kind,
          pollOf(payload),
          extra,
        );
        replace({
          ...useDocs.getState(),
          [key]: { circleId, version, shared, authorId: me, payload },
        });
        return 'saved';
      } catch (error) {
        const refusal = deps.refusal(error);
        if (refusal === 'DOCS_FULL') return 'full';
        if (refusal === 'FORBIDDEN') return 'forbidden';
        if (refusal === 'VERSION_CONFLICT' || refusal === 'MEETING_EXISTS') {
          // Someone was faster (or started theirs first): this phone shows what is there.
          await syncCircle(circle).catch(() => undefined);
          return refusal === 'MEETING_EXISTS' ? 'exists' : 'conflict';
        }
        if (refusal === 'EPOCH_STALE' && options.retried !== true) {
          await deps.refreshCircle(circleId);
          return this.save(circleId, draft, { ...options, retried: true });
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

    /** Documents of circles this phone is no longer in (left, removed, ended) go. */
    prune(): void {
      restore();
      const active = new Set(activeCircles(deps.circles()).map((circle) => circle.id));
      const current = useDocs.getState();
      const kept = Object.fromEntries(
        Object.entries(current).filter(([, doc]) => active.has(doc.circleId)),
      );
      if (Object.keys(kept).length !== Object.keys(current).length) replace(kept);
    },

    reset(): void {
      restored = false;
      synced.clear();
      useDocs.setState({}, true);
    },
  };
}

export type Docs = ReturnType<typeof createDocs>;

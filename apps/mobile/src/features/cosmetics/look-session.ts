import { encryptMessage } from '@bargu/crypto';
import {
  type Circle,
  type CosmeticPass,
  cosmeticPassSchema,
  MAX_ENVELOPES_PER_PUBLISH,
  type MessageEnvelope,
  type Payload,
  type Plan,
  publishReplySchema,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import { api, useAuth } from '../auth/auth-store';
import { planKey } from '../billing/plan';
import { circlesKey } from '../circles/circle-cache';
import { keys, liveRequest } from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { fetchPass } from './cosmetics-api';
import { audienceOf, lookMarker, lookOf, passDue } from './look-model';
import { type Look, type LookChoice, PLAIN_CHOICE } from './look-styles';
import { trustedKeys } from './trusted-keys';

type LookPayload = Extract<Payload, { kind: 'look' }>;

/** Kept in the encrypted vault: the choice, the pass, what each circle got, others' looks. */
const CHOICE_KEY = 'look:choice:v1';
const PASS_KEY = 'look:pass:v1';
const PUBLISHED_KEY = 'look:published:v1';
const LOOKS_KEY = 'look:others:v1';

const choiceSchema = z.object({ ring: z.string().nullable(), frame: z.string().nullable() });
const publishedSchema = z.record(z.string(), z.string());
/** A look as it came (its pass too), so that it is checked again after a restart. */
const keptSchema = z.record(
  z.string(),
  z.object({
    ring: z.string().nullable(),
    frame: z.string().nullable(),
    pass: cosmeticPassSchema.nullable(),
    ts: z.number(),
  }),
);
type Kept = z.infer<typeof keptSchema>;

function read<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  const raw = vault().get(key);
  if (raw === undefined) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/**
 * This phone's own choice and pass (docs/ADR/0025), and the look they give (`look`: only what the
 * pass holds for the user, as others will see it; null is the plain one).
 */
export const useMyLook = create<{
  choice: LookChoice;
  pass: CosmeticPass | null;
  look: Look | null;
}>(() => ({ choice: PLAIN_CHOICE, pass: null, look: null }));

/** Others' looks, checked when they came; each shows until its pass runs out (`lookAt`). */
export const useLooks = create<Record<string, Look & { ts: number }>>(() => ({}));

/** What the others' messages said, as kept in the vault (see `keptSchema`). */
let kept: Kept = {};
/** The newest look message of each member, plain ones too: an older one coming later is dropped. */
const seen = new Map<string, number>();
let restored = false;

function setMine(choice: LookChoice, pass: CosmeticPass | null, now = Date.now()): void {
  const me = useAuth.getState().userId;
  const look = me === null ? null : lookOf(me, choice, pass, trustedKeys, now);
  useMyLook.setState({ choice, pass, look }, true);
}

function show(userId: string, entry: Kept[string], now: number): void {
  const checked = lookOf(userId, entry, entry.pass, trustedKeys, now);
  const others = Object.fromEntries(
    Object.entries(useLooks.getState()).filter(([id]) => id !== userId),
  );
  if (checked !== null) others[userId] = { ...checked, ts: entry.ts };
  useLooks.setState(others, true);
}

/**
 * The choice, the pass and others' looks kept from before, shown at once after a restart. Looks
 * that came since (the relay's snapshot may be first) are newer and stay.
 */
export function restoreLooks(now = Date.now()): void {
  if (restored || !isVaultOpen()) return;
  restored = true;
  setMine(
    read(CHOICE_KEY, choiceSchema, PLAIN_CHOICE),
    read(PASS_KEY, cosmeticPassSchema.nullable(), null),
    now,
  );
  const before = read(LOOKS_KEY, keptSchema, {});
  for (const [userId, entry] of Object.entries(before)) {
    if ((seen.get(userId) ?? 0) >= entry.ts) continue;
    seen.set(userId, entry.ts);
    kept[userId] = entry;
    show(userId, entry, now);
  }
}

function circlesWithOthers(): Circle[] {
  const me = useAuth.getState().userId;
  return (queryClient.getQueryData<Circle[]>(circlesKey) ?? []).filter(
    (circle) =>
      circle.myStatus === 'active' &&
      circle.members.some((member) => member.userId !== me && member.status === 'active'),
  );
}

async function send(envelopes: MessageEnvelope[]): Promise<void> {
  for (let start = 0; start < envelopes.length; start += MAX_ENVELOPES_PER_PUBLISH) {
    const body = { envelopes: envelopes.slice(start, start + MAX_ENVELOPES_PER_PUBLISH) };
    const viaSocket = liveRequest('look', body);
    const reply = viaSocket === null ? null : await viaSocket.catch(() => null);
    if (publishReplySchema.safeParse(reply).success) continue;
    await api.authed('/v1/looks', { method: 'POST', body });
  }
}

/** The publishing now, and whether something changed meanwhile so that it must go round again. */
const queue: { running: Promise<void> | null; again: boolean } = { running: null, again: false };

/** Whether `publishLook` was called while a round ran (read through a function, not narrowed). */
const changedMeanwhile = (): boolean => queue.again;

/**
 * Tells circles this phone's look (docs/ADR/0025 §3), encrypted per circle, wherever the profile
 * goes: every circle whose epoch changed (new members), whose readers changed (a new phone, trust
 * given after a key change) or that has not heard the current choice and pass. Without a look,
 * nothing for a circle that never heard of one; after one, the plain look is told once, so the old
 * one goes. Two calls at once are one run and a second round.
 */
export function publishLook(): Promise<void> {
  if (queue.running !== null) {
    queue.again = true;
    return queue.running;
  }
  const run = (async () => {
    do {
      queue.again = false;
      await publishOnce();
    } while (changedMeanwhile());
  })().finally(() => {
    queue.running = null;
  });
  queue.running = run;
  return run;
}

async function publishOnce(): Promise<void> {
  const device = useAuth.getState().device;
  const me = useAuth.getState().userId;
  if (device === null || !isVaultOpen()) return;
  restoreLooks();
  const { choice, pass } = useMyLook.getState();
  const plain = choice.ring === null && choice.frame === null;
  const published = read(PUBLISHED_KEY, publishedSchema, {});
  const store = keys();
  const due = circlesWithOthers().flatMap((circle) => {
    const marker = lookMarker(
      circle.epoch,
      choice,
      pass,
      audienceOf(circle, me, (member) => store.trusted(member)),
    );
    return published[circle.id] === marker ? [] : [{ circle, marker }];
  });
  if (due.length === 0) return;
  const next = { ...published };
  const envelopes: MessageEnvelope[] = [];
  for (const { circle, marker } of due) {
    const told = published[circle.id];
    next[circle.id] = marker;
    if (plain && told === undefined) continue;
    const payload: LookPayload = { kind: 'look', ...choice, pass, ts: Date.now() };
    envelopes.push(
      encryptMessage({
        state: { senderKey: store.ownKey(circle), nextSeq: store.reserveSeq(circle) },
        sender: device,
        payload,
      }).envelope,
    );
  }
  if (envelopes.length > 0) await send(envelopes);
  vault().set(PUBLISHED_KEY, JSON.stringify(next));
}

/** Ben > Görünüm: the choice changes, and the circles hear it. */
export async function chooseLook(choice: LookChoice): Promise<void> {
  if (!isVaultOpen()) return;
  restoreLooks();
  vault().set(CHOICE_KEY, JSON.stringify(choice));
  setMine(choice, useMyLook.getState().pass);
  await publishLook();
}

/** The packs the account has, as its plan (in the query cache) says. */
const ownedPacks = (): readonly string[] =>
  queryClient.getQueryData<Plan>(planKey)?.cosmetics ?? [];

let refreshing: Promise<void> | null = null;

/**
 * A new pass when there is none, less than half of it is left, or the plan has a pack it does not
 * name (docs/ADR/0025 §1); or always (`force`, right after buying a pack). Changed, the circles
 * get it with the look. Several calls at once are one request.
 */
export function refreshPass(force = false): Promise<void> {
  refreshing ??= refresh(force).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refresh(force: boolean): Promise<void> {
  if (!isVaultOpen()) return;
  restoreLooks();
  const { choice, pass } = useMyLook.getState();
  if (!force && !passDue(pass, Date.now(), ownedPacks())) return;
  const next = await fetchPass();
  if (next?.issuedAt === pass?.issuedAt && next?.expiresAt === pass?.expiresAt) return;
  if (next === null) vault().delete(PASS_KEY);
  else vault().set(PASS_KEY, JSON.stringify(next));
  setMine(choice, next);
  await publishLook();
}

/**
 * A member's look message: shown only as far as their pass holds for them (a trusted key, theirs,
 * in time, naming its pack); otherwise the plain look. Never an error. The newest one counts.
 */
export function receivedLook(userId: string, look: LookPayload, now = Date.now()): void {
  restoreLooks(now);
  if ((seen.get(userId) ?? 0) > look.ts) return;
  seen.set(userId, look.ts);
  const entry = { ring: look.ring, frame: look.frame, pass: look.pass, ts: look.ts };
  show(userId, entry, now);
  const rest = Object.fromEntries(Object.entries(kept).filter(([id]) => id !== userId));
  kept = useLooks.getState()[userId] === undefined ? rest : { ...rest, [userId]: entry };
  if (isVaultOpen()) vault().set(LOOKS_KEY, JSON.stringify(kept));
}

/** Sign-out. */
export function resetLooks(): void {
  restored = false;
  kept = {};
  seen.clear();
  queue.running = null;
  queue.again = false;
  setMine(PLAIN_CHOICE, null);
  useLooks.setState({}, true);
}

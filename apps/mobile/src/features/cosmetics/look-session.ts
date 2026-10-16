import { encryptMessage } from '@bargu/crypto';
import {
  type Circle,
  type CosmeticPass,
  cosmeticPassSchema,
  MAX_ENVELOPES_PER_PUBLISH,
  type MessageEnvelope,
  type Payload,
  publishReplySchema,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import { api, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { keys, liveRequest } from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { fetchPass } from './cosmetics-api';
import { type Look, type LookChoice, lookMarker, lookOf, passDue } from './look-model';
import { trustedKeys } from './trusted-keys';

type LookPayload = Extract<Payload, { kind: 'look' }>;

/** Kept in the encrypted vault: the choice, the pass, what each circle got, others' looks. */
const CHOICE_KEY = 'look:choice:v1';
const PASS_KEY = 'look:pass:v1';
const PUBLISHED_KEY = 'look:published:v1';
const LOOKS_KEY = 'look:others:v1';

const choiceSchema = z.object({ island: z.string().nullable(), edge: z.string().nullable() });
const PLAIN: LookChoice = { island: null, edge: null };
const lookSchema = z.object({
  island: z.string().optional(),
  edge: z.string().optional(),
  until: z.number(),
  ts: z.number(),
});
const looksSchema = z.record(z.string(), lookSchema);

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

/** This phone's own choice and pass (docs/ADR/0025): what Ben > Görünüm shows and sends. */
export const useMyLook = create<{ choice: LookChoice; pass: CosmeticPass | null }>(() => ({
  choice: PLAIN,
  pass: null,
}));

/** Others' looks, checked (their pass held when it came); each shows until its pass runs out. */
export const useLooks = create<Record<string, Look & { ts: number }>>(() => ({}));

/** The look this phone shows for itself: only what its own pass gives (as others will see it). */
export function myLook(now = Date.now()): Look | null {
  const me = useAuth.getState().userId;
  const { choice, pass } = useMyLook.getState();
  return me === null ? null : lookOf(me, choice, pass, trustedKeys, now);
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

/**
 * Tells circles this phone's look (docs/ADR/0025 §3), encrypted per circle, wherever the profile
 * goes: every circle whose epoch changed (new members, new devices) or that has not heard the
 * current choice and pass. Without a look, nothing for a circle that never heard of one; after
 * one, the plain look is told once, so the old one goes.
 */
export async function publishLook(): Promise<void> {
  const device = useAuth.getState().device;
  if (device === null || !isVaultOpen()) return;
  const { choice, pass } = useMyLook.getState();
  const plain = choice.island === null && choice.edge === null;
  const published = read(PUBLISHED_KEY, z.record(z.string(), z.string()), {});
  const store = keys();
  const due = circlesWithOthers().filter(
    (circle) => published[circle.id] !== lookMarker(circle.epoch, choice, pass),
  );
  if (due.length === 0) return;
  const next = { ...published };
  const envelopes: MessageEnvelope[] = [];
  for (const circle of due) {
    const told = published[circle.id];
    next[circle.id] = lookMarker(circle.epoch, choice, pass);
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
  vault().set(CHOICE_KEY, JSON.stringify(choice));
  useMyLook.setState({ choice });
  await publishLook();
}

/**
 * A new pass when there is none or less than half of it is left, or always (`force`: a pack was
 * bought or refunded, plan.changed). Changed, the circles get it with the look.
 */
export async function refreshPass(force = false): Promise<void> {
  if (!isVaultOpen()) return;
  const { pass } = useMyLook.getState();
  if (!force && !passDue(pass, Date.now())) return;
  const next = await fetchPass();
  if (next?.issuedAt === pass?.issuedAt && next?.expiresAt === pass?.expiresAt) return;
  if (next === null) vault().delete(PASS_KEY);
  else vault().set(PASS_KEY, JSON.stringify(next));
  useMyLook.setState({ pass: next });
  await publishLook();
}

/**
 * A member's look message: shown only as far as their pass holds for them (a trusted key, theirs,
 * in time, naming its pack); otherwise the plain look. Never an error. The newest one counts.
 */
export function receivedLook(userId: string, look: LookPayload, now = Date.now()): void {
  const current = useLooks.getState()[userId];
  if (current !== undefined && current.ts > look.ts) return;
  const checked = lookOf(userId, look, look.pass, trustedKeys, now);
  const next = Object.fromEntries(
    Object.entries(useLooks.getState()).filter(([id]) => id !== userId),
  );
  if (checked !== null) next[userId] = { ...checked, ts: look.ts };
  useLooks.setState(next, true);
  if (isVaultOpen()) vault().set(LOOKS_KEY, JSON.stringify(next));
}

/** The choice, the pass and others' looks kept from before, shown at once after a restart. */
export function restoreLooks(now = Date.now()): void {
  if (!isVaultOpen()) return;
  const pass = read(PASS_KEY, cosmeticPassSchema.nullable(), null);
  useMyLook.setState({ choice: read(CHOICE_KEY, choiceSchema, PLAIN), pass }, true);
  const kept = read(LOOKS_KEY, looksSchema, {});
  // Checked when they came; only those whose pass still holds come back.
  const looks = Object.fromEntries(
    Object.entries(kept).filter(([, look]) => look.until > now),
  ) as Record<string, Look & { ts: number }>;
  useLooks.setState(looks, true);
}

/** Sign-out. */
export function resetLooks(): void {
  useMyLook.setState({ choice: PLAIN, pass: null }, true);
  useLooks.setState({}, true);
}

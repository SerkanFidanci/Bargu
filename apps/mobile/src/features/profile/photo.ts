import {
  encryptMessage,
  fromBase64url,
  generatePhotoKey,
  MAX_PHOTO_BYTES,
  openProfilePhoto,
  randomUuid,
  sealProfilePhoto,
  toBase64url,
} from '@bargu/crypto';
import {
  type Circle,
  MAX_ENVELOPES_PER_PUBLISH,
  type MessageEnvelope,
  type Payload,
  photoSchema,
  publishReplySchema,
} from '@bargu/schemas';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { z } from 'zod';

import { useAvatarPhotos } from '@/ui/avatar-photos';

import { api, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { keys, liveRequest } from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';

type ProfilePayload = Extract<Payload, { kind: 'profile' }>;

/** Profile photos by user id (decrypted on this phone only); <Avatar> reads them. */
export const usePhotos = useAvatarPhotos;

/** Side of the square photo sent (px); small: it is an avatar. */
const PHOTO_PX = 256;
/** JPEG qualities tried in turn until the photo fits MAX_PHOTO_BYTES. */
const QUALITIES = [0.75, 0.55, 0.35] as const;

const MINE_KEY = 'photo:mine:v1';
const KEYS_KEY = 'photo:keys:v1';
const PUBLISHED_KEY = 'photo:published:v1';
const imageKey = (userId: string) => `photo:img:${userId}`;

const mineSchema = z.object({ id: z.string(), key: z.string(), image: z.string() }).strict();
const cachedSchema = z.object({ id: z.string(), image: z.string() }).strict();
const keysSchema = z.record(z.string(), z.object({ id: z.string(), key: z.string() }).strict());
const publishedSchema = z.record(z.string(), z.string());

/** base64 (the image tools) ↔ base64url (our encoding). */
const toUrl = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function toStandard(b64url: string): string {
  const plain = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return plain + '='.repeat((4 - (plain.length % 4)) % 4);
}
const dataUri = (b64url: string) => `data:image/jpeg;base64,${toStandard(b64url)}`;

function read<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  if (!isVaultOpen()) return fallback;
  const raw = vault().get(key);
  if (raw === undefined) return fallback;
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : fallback;
}

/**
 * Lets the user pick a photo, crops it square (system editor), shrinks it to 256 px and compresses
 * it under 40 KB. Null when cancelled. Only the library: no camera, nothing recorded.
 */
export async function pickPhoto(): Promise<Uint8Array | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (asset === undefined) return null;
  const image = await ImageManipulator.manipulate(asset.uri)
    .resize({ width: PHOTO_PX, height: PHOTO_PX })
    .renderAsync();
  for (const compress of QUALITIES) {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
    if (saved.base64 === undefined) continue;
    const bytes = fromBase64url(toUrl(saved.base64));
    if (bytes.length <= MAX_PHOTO_BYTES) return bytes;
  }
  throw new Error('photo too large');
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
    const viaSocket = liveRequest('profile', body);
    const reply = viaSocket === null ? null : await viaSocket.catch(() => null);
    if (publishReplySchema.safeParse(reply).success) continue;
    await api.authed('/v1/profile-keys', { method: 'POST', body });
  }
}

/**
 * Tells circles the current photo key (or that there is none), encrypted per circle. Done for
 * every circle whose epoch changed since (new members get it), so `force` only after a change.
 */
export async function publishProfile(force = false): Promise<void> {
  const device = useAuth.getState().device;
  if (device === null || !isVaultOpen()) return;
  const mine = read(MINE_KEY, mineSchema.nullable(), null);
  const published = read(PUBLISHED_KEY, publishedSchema, {});
  const circles = circlesWithOthers().filter(
    (circle) => force || published[circle.id] !== `${String(circle.epoch)}:${mine?.id ?? '-'}`,
  );
  if (circles.length === 0) return;
  // Without a photo, nothing to tell a circle that never heard of one.
  if (mine === null && !force) {
    const next = { ...published };
    for (const circle of circles) next[circle.id] = `${String(circle.epoch)}:-`;
    vault().set(PUBLISHED_KEY, JSON.stringify(next));
    return;
  }
  const payload: ProfilePayload = {
    kind: 'profile',
    photo: mine === null ? null : { id: mine.id, key: mine.key },
    ts: Date.now(),
  };
  const store = keys();
  const envelopes = circles.map(
    (circle) =>
      encryptMessage({
        state: { senderKey: store.ownKey(circle), nextSeq: store.reserveSeq(circle) },
        sender: device,
        payload,
      }).envelope,
  );
  await send(envelopes);
  const next = { ...published };
  for (const circle of circles) next[circle.id] = `${String(circle.epoch)}:${mine?.id ?? '-'}`;
  vault().set(PUBLISHED_KEY, JSON.stringify(next));
}

/** Sets a new profile photo: encrypted here, uploaded, its key sent to every circle. */
export async function setPhoto(image: Uint8Array): Promise<void> {
  const userId = useAuth.getState().userId;
  if (userId === null) throw new Error('signed out');
  const id = randomUuid();
  const key = generatePhotoKey();
  await api.authed('/v1/me/photo', {
    method: 'PUT',
    body: { photoId: id, ciphertext: toBase64url(sealProfilePhoto(key, id, image)) },
  });
  const image64 = toBase64url(image);
  vault().set(MINE_KEY, JSON.stringify({ id, key: toBase64url(key), image: image64 }));
  usePhotos.setState({ [userId]: dataUri(image64) });
  await publishProfile(true);
}

/** Back to the emoji avatar everywhere. */
export async function removePhoto(): Promise<void> {
  const userId = useAuth.getState().userId;
  await api.authed('/v1/me/photo', { method: 'DELETE' });
  vault().delete(MINE_KEY);
  if (userId !== null) dropPhoto(userId);
  await publishProfile(true);
}

function dropPhoto(userId: string): void {
  const current = usePhotos.getState();
  if (!(userId in current)) return;
  usePhotos.setState(
    Object.fromEntries(Object.entries(current).filter(([id]) => id !== userId)),
    true,
  );
}

/** Whether the user has a photo set (for the profile screen). */
export function hasOwnPhoto(): boolean {
  return read(MINE_KEY, mineSchema.nullable(), null) !== null;
}

/**
 * A member's profile message: remember the key, fetch and open the photo if it is new. The photo
 * is decrypted here and kept in the encrypted vault; the server only ever had ciphertext.
 */
export async function receivedProfile(userId: string, profile: ProfilePayload): Promise<void> {
  const known = read(KEYS_KEY, keysSchema, {});
  if (profile.photo === null) {
    const rest = Object.fromEntries(Object.entries(known).filter(([id]) => id !== userId));
    vault().set(KEYS_KEY, JSON.stringify(rest));
    vault().delete(imageKey(userId));
    dropPhoto(userId);
    return;
  }
  vault().set(KEYS_KEY, JSON.stringify({ ...known, [userId]: profile.photo }));
  const cached = read(imageKey(userId), cachedSchema.nullable(), null);
  if (cached?.id === profile.photo.id) return;
  const photo = photoSchema.parse(await api.authed(`/v1/users/${userId}/photo`));
  if (photo.photoId !== profile.photo.id) return;
  const image = openProfilePhoto(
    fromBase64url(profile.photo.key, 32),
    photo.photoId,
    fromBase64url(photo.ciphertext),
  );
  const image64 = toBase64url(image);
  vault().set(imageKey(userId), JSON.stringify({ id: photo.photoId, image: image64 }));
  usePhotos.setState({ [userId]: dataUri(image64) });
}

/** Photos kept from before (own and others'), shown at once after a restart. */
export function restorePhotos(): void {
  if (!isVaultOpen()) return;
  const photos: Record<string, string> = {};
  const userId = useAuth.getState().userId;
  const mine = read(MINE_KEY, mineSchema.nullable(), null);
  if (mine !== null && userId !== null) photos[userId] = dataUri(mine.image);
  for (const key of vault().keys()) {
    if (!key.startsWith('photo:img:')) continue;
    const cached = read(key, cachedSchema.nullable(), null);
    if (cached !== null) photos[key.slice('photo:img:'.length)] = dataUri(cached.image);
  }
  usePhotos.setState(photos, true);
}

/** Sign-out. */
export function resetPhotos(): void {
  usePhotos.setState({}, true);
}

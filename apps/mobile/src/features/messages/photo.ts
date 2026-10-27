import {
  fromBase64url,
  generatePhotoKey,
  openChatPhoto,
  photoHashOf,
  randomUuid,
  sealChatPhoto,
  toBase64url,
} from '@bargu/crypto';
import { CHAT_PHOTO_MAX_SIDE, type ChatPhoto } from '@bargu/schemas';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { messagesApi } from './messages-api';

/**
 * A photo of messages and moments (docs/ADR/0035 §4): taken by the app's camera that moment,
 * re-encoded here (no EXIF, no GPS), its long side at most 1600 px and at most 500 KB, sealed with
 * its own one-time key and uploaded once. The server only ever has the sealed bytes; the opened
 * photo lives in memory while it is shown.
 */

/** The JPEG's limit before sealing (the sealed file may be 600 KB, §10). */
export const PHOTO_JPEG_MAX_BYTES = 500 * 1024;
/** JPEG qualities tried in turn until the photo fits. */
const QUALITIES = [0.8, 0.65, 0.5, 0.35] as const;
/** Sealed files kept in memory (sent or opened lately): the viewer and a report reuse them. */
const KEPT_FILES = 12;

/** A taken photo, ready to seal. */
export interface TakenPhoto {
  jpeg: Uint8Array;
  w: number;
  h: number;
}

/** What a `photo` item carries of its file (the payload without its id, story, caption and time). */
export type PhotoFile = Pick<ChatPhoto, 'blobId' | 'key' | 'size' | 'hash' | 'w' | 'h'>;

/** base64 (the image tools) → base64url (our encoding). */
const toUrl = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** An unencrypted picture written by the camera or the image tools: it does not stay on disk. */
export function discardFile(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // Already gone; the system clears its cache folder too.
  }
}

/**
 * The camera's picture, made small and written again as a plain JPEG. The files the camera and the
 * image tools wrote go once the bytes are in memory.
 */
export async function preparePhoto(
  uri: string,
  width: number,
  height: number,
): Promise<TakenPhoto> {
  try {
    const longSide = Math.max(width, height);
    const scale = longSide > CHAT_PHOTO_MAX_SIDE ? CHAT_PHOTO_MAX_SIDE / longSide : 1;
    const context =
      scale < 1
        ? ImageManipulator.manipulate(uri).resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
          })
        : ImageManipulator.manipulate(uri);
    const image = await context.renderAsync();
    for (const compress of QUALITIES) {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
      discardFile(saved.uri);
      if (saved.base64 === undefined) continue;
      const jpeg = fromBase64url(toUrl(saved.base64));
      if (jpeg.length <= PHOTO_JPEG_MAX_BYTES) {
        return {
          jpeg,
          w: Math.min(CHAT_PHOTO_MAX_SIDE, saved.width),
          h: Math.min(CHAT_PHOTO_MAX_SIDE, saved.height),
        };
      }
    }
    throw new Error('photo too large');
  } finally {
    discardFile(uri);
  }
}

const files = new Map<string, Uint8Array>();
/** Ids of files this phone uploaded in this run (sending again does not upload again). */
const uploaded = new Set<string>();
/** Uploads under way, by file. */
const uploading = new Map<string, Promise<boolean>>();

function keep(blobId: string, sealed: Uint8Array): void {
  files.delete(blobId);
  files.set(blobId, sealed);
  while (files.size > KEPT_FILES) {
    const oldest = files.keys().next().value;
    if (oldest === undefined) break;
    files.delete(oldest);
  }
}

/** Seals a photo with a fresh key; the file stays in memory until it is uploaded. */
export function sealPhoto(photo: TakenPhoto): PhotoFile {
  const blobId = randomUuid();
  const key = generatePhotoKey();
  const sealed = sealChatPhoto(key, blobId, photo.jpeg);
  keep(blobId, sealed);
  const file: PhotoFile = {
    blobId,
    key: toBase64url(key),
    size: sealed.length,
    hash: photoHashOf(sealed),
    w: photo.w,
    h: photo.h,
  };
  key.fill(0);
  return file;
}

/**
 * Uploads a sealed photo once. False when this phone no longer has it (restarted meanwhile): then
 * it cannot be sent again.
 */
export function uploadPhoto(blobId: string): Promise<boolean> {
  if (uploaded.has(blobId)) return Promise.resolve(true);
  // A story's items go to their circles at once: they wait for the same upload.
  const going = uploading.get(blobId);
  if (going !== undefined) return going;
  const sealed = files.get(blobId);
  if (sealed === undefined) return Promise.resolve(false);
  const upload = messagesApi.upload(blobId, sealed).then(
    () => {
      uploaded.add(blobId);
      uploading.delete(blobId);
      return true;
    },
    (error: unknown) => {
      uploading.delete(blobId);
      throw error;
    },
  );
  uploading.set(blobId, upload);
  return upload;
}

/** The sealed file of a photo: from memory, or downloaded (and kept a while). */
export async function sealedFileOf(blobId: string): Promise<Uint8Array> {
  const kept = files.get(blobId);
  if (kept !== undefined) return kept;
  const sealed = await messagesApi.download(blobId);
  keep(blobId, sealed);
  return sealed;
}

/** The sealed file, only if this phone has it at hand (a report hands it over when it can). */
export function keptFileOf(blobId: string): Uint8Array | undefined {
  return files.get(blobId);
}

/** Opens a photo for showing: the file its item names, with that item's key, or it throws. */
export async function openPhoto(
  photo: Pick<PhotoFile, 'blobId' | 'key' | 'hash'>,
): Promise<string> {
  const sealed = await sealedFileOf(photo.blobId);
  const jpeg = openChatPhoto({
    key: fromBase64url(photo.key, 32),
    blobId: photo.blobId,
    hash: photo.hash,
    sealed,
  });
  return jpegUri(jpeg);
}

/** An in-memory JPEG as an image source (never a file). */
export function jpegUri(jpeg: Uint8Array): string {
  return `data:image/jpeg;base64,${toStandardBase64(jpeg)}`;
}

function toStandardBase64(bytes: Uint8Array): string {
  const plain = toBase64url(bytes).replace(/-/g, '+').replace(/_/g, '/');
  return plain + '='.repeat((4 - (plain.length % 4)) % 4);
}

/** Sign-out: nothing of the last account stays in memory. */
export function forgetPhotoFiles(): void {
  files.clear();
  uploaded.clear();
  uploading.clear();
}

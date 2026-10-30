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
import { Directory, File, Paths } from 'expo-file-system';
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
export const PHOTO_QUALITIES = [0.8, 0.65, 0.5, 0.35] as const;
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

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
/** RST0–RST7: restart markers inside the picture data, two bytes and no length. */
const RST0 = 0xd0;
const RST7 = 0xd7;
/** APP1–APP15 (EXIF with any GPS, XMP, ICC, Photoshop's APP13 and the rest) and COM: notes, not picture. */
const APP1 = 0xe1;
const APP15 = 0xef;
const COM = 0xfe;

/** Thrown when a photo's file cannot be read as a JPEG: it is not sent, the user takes it again. */
export class UnreadablePhotoError extends Error {
  constructor() {
    super('unreadable photo');
    this.name = 'UnreadablePhotoError';
  }
}

/**
 * The JPEG with nothing but the picture (the PM, 2026-10-29 and QA-43): every APP1–APP15 segment
 * (EXIF with any place in it, XMP, APP13 and the like) and every comment goes, wherever it stands,
 * and so does anything after the end of the image. APP0 (JFIF) and the picture's own tables stay.
 * Fill bytes (0xFF before a marker) are read as JPEG allows. Checked before every photo is sealed,
 * edited or not: the encoders used here write none of these, and this makes sure of it. A file it
 * cannot read as JPEG segments is null and must not be sent: never passed on as it came.
 */
export function withoutExif(jpeg: Uint8Array): Uint8Array | null {
  const byte = (at: number) => jpeg[at] ?? -1;
  if (byte(0) !== 0xff || byte(1) !== SOI) return null;
  const kept: Uint8Array[] = [jpeg.subarray(0, 2)];
  let at = 2;
  let scanned = false;
  for (;;) {
    // A marker: 0xFF, any fill bytes, then its code.
    if (byte(at) !== 0xff) return null;
    while (byte(at + 1) === 0xff) at += 1;
    const marker = byte(at + 1);
    if (marker < 0) return null;
    if (marker === EOI) {
      if (!scanned) return null;
      kept.push(jpeg.subarray(at, at + 2));
      break;
    }
    if (marker === SOI || marker === 0x00 || (marker >= RST0 && marker <= RST7)) return null;
    const length = (byte(at + 2) << 8) | byte(at + 3);
    if (byte(at + 3) < 0 || length < 2 || at + 2 + length > jpeg.length) return null;
    const segmentEnd = at + 2 + length;
    const note = (marker >= APP1 && marker <= APP15) || marker === COM;
    if (marker !== SOS) {
      if (!note) kept.push(jpeg.subarray(at, segmentEnd));
      at = segmentEnd;
      continue;
    }
    // A scan: its header, then picture data up to the next marker. In the data 0xFF is followed
    // by 0x00 (a data byte), a restart marker or more fill bytes; anything else is a marker.
    scanned = true;
    let data = segmentEnd;
    for (;;) {
      if (data >= jpeg.length) return null;
      if (byte(data) !== 0xff) {
        data += 1;
        continue;
      }
      let next = data + 1;
      while (byte(next) === 0xff) next += 1;
      const code = byte(next);
      if (code < 0) return null;
      if (code === 0x00 || (code >= RST0 && code <= RST7)) {
        data = next + 1;
        continue;
      }
      break;
    }
    kept.push(jpeg.subarray(at, data));
    at = data;
  }
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

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
    for (const compress of PHOTO_QUALITIES) {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
      discardFile(saved.uri);
      if (saved.base64 === undefined) continue;
      const jpeg = withoutExif(fromBase64url(toUrl(saved.base64)));
      if (jpeg === null) throw new UnreadablePhotoError();
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

/**
 * Whether a photo can still be sent again: uploaded already, or its sealed file still in memory.
 * After a restart it cannot; its bubble then asks for a new photo (PM, M4).
 */
export function canResend(blobId: string): boolean {
  return uploaded.has(blobId) || files.has(blobId);
}

/** Where the camera and the image tools write their unencrypted pictures, under the cache. */
const PICTURE_FOLDERS = ['Camera', 'ImageManipulator'] as const;

/**
 * At start: whatever the camera or the image tools left behind (the app was closed while a photo
 * was being made small) goes, so no unencrypted picture outlives its moment (QA-38).
 */
export function sweepPictureFiles(): void {
  for (const name of PICTURE_FOLDERS) {
    try {
      const folder = new Directory(Paths.cache, name);
      if (folder.exists) folder.delete();
    } catch {
      // Nothing there, or the system cleared its cache already.
    }
  }
}

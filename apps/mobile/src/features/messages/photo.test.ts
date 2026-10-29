import { photoHashOf, randomUuid } from '@bargu/crypto';

const mockUpload = jest.fn<Promise<void>, [string, Uint8Array]>(() => Promise.resolve());
const mockDownload = jest.fn<Promise<Uint8Array>, [string]>();
jest.mock('./messages-api', () => ({
  messagesApi: {
    upload: (blobId: string, sealed: Uint8Array) => mockUpload(blobId, sealed),
    download: (blobId: string) => mockDownload(blobId),
  },
}));
const mockFolders = new Map<string, { exists: boolean; delete: jest.Mock }>();
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  Paths: { cache: 'cache' },
  Directory: jest.fn((_parent: string, name: string) => {
    const folder = mockFolders.get(name) ?? { exists: false, delete: jest.fn() };
    mockFolders.set(name, folder);
    return folder;
  }),
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));

import {
  forgetPhotoFiles,
  keptFileOf,
  openPhoto,
  sealPhoto,
  sealedFileOf,
  sweepPictureFiles,
  uploadPhoto,
  withoutExif,
} from './photo';

const JPEG = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]);

beforeEach(() => {
  jest.clearAllMocks();
  forgetPhotoFiles();
});

describe('a photo of messages and moments', () => {
  it('is sealed with its own key; its item names its size and hash, never the photo', () => {
    const first = sealPhoto({ jpeg: JPEG, w: 1600, h: 1200 });
    const second = sealPhoto({ jpeg: JPEG, w: 1600, h: 1200 });
    expect(first.key).not.toBe(second.key);
    expect(first.blobId).not.toBe(second.blobId);
    const sealed = keptFileOf(first.blobId);
    expect(sealed?.length).toBe(first.size);
    expect(photoHashOf(sealed ?? new Uint8Array())).toBe(first.hash);
    expect(sealed?.some((_, at) => JPEG.every((byte, i) => sealed[at + i] === byte))).toBe(false);
  });

  it('goes up once, however many items share it', async () => {
    const file = sealPhoto({ jpeg: JPEG, w: 10, h: 10 });
    await expect(uploadPhoto(file.blobId)).resolves.toBe(true);
    await expect(uploadPhoto(file.blobId)).resolves.toBe(true);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    // After a restart this phone no longer has it: it cannot be sent again.
    forgetPhotoFiles();
    await expect(uploadPhoto(file.blobId)).resolves.toBe(false);
  });

  it('opens with its item key, from memory or downloaded, and refuses another file', async () => {
    const file = sealPhoto({ jpeg: JPEG, w: 10, h: 10 });
    const sealed = keptFileOf(file.blobId) ?? new Uint8Array();
    await expect(openPhoto(file)).resolves.toBe('data:image/jpeg;base64,/9gBAgP/2Q==');

    forgetPhotoFiles();
    mockDownload.mockResolvedValueOnce(sealed);
    await expect(openPhoto(file)).resolves.toMatch(/^data:image\/jpeg;base64,/);
    expect(mockDownload).toHaveBeenCalledWith(file.blobId);
    await expect(sealedFileOf(file.blobId)).resolves.toBe(sealed);

    const other = sealPhoto({ jpeg: JPEG, w: 10, h: 10 });
    await expect(openPhoto({ ...file, blobId: other.blobId })).rejects.toThrow();
    await expect(openPhoto({ ...file, key: other.key })).rejects.toThrow();
  });

  it('is forgotten at sign-out', () => {
    const file = sealPhoto({ jpeg: JPEG, w: 10, h: 10 });
    forgetPhotoFiles();
    expect(keptFileOf(file.blobId)).toBeUndefined();
    expect(keptFileOf(randomUuid())).toBeUndefined();
  });
});

describe('the pictures a closed app left', () => {
  it('go at start: the camera’s and the image tools’ folders, and nothing else', () => {
    mockFolders.set('Camera', { exists: true, delete: jest.fn() });
    mockFolders.set('ImageManipulator', { exists: false, delete: jest.fn() });
    sweepPictureFiles();
    expect(mockFolders.get('Camera')?.delete).toHaveBeenCalledTimes(1);
    expect(mockFolders.get('ImageManipulator')?.delete).not.toHaveBeenCalled();
    expect([...mockFolders.keys()].sort()).toEqual(['Camera', 'ImageManipulator']);
  });
});

describe('no EXIF in what is sealed (the PM, 2026-10-29), edited or not', () => {
  /** A JPEG segment: its marker and its bytes, with the length JPEG gives it. */
  const segment = (marker: number, bytes: number[]) => [
    0xff,
    marker,
    (bytes.length + 2) >> 8,
    (bytes.length + 2) & 255,
    ...bytes,
  ];
  const exif = [0x45, 0x78, 0x69, 0x66]; // "Exif"
  const jpeg = (...segments: number[][]) =>
    new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);

  it('takes out every APP1 segment (EXIF with its GPS, XMP) and keeps the picture whole', () => {
    const app0 = segment(0xe0, [74, 70, 73, 70, 0]);
    const gps = segment(0xe1, [...exif, 0, 0, 9, 9, 9]);
    const xmp = segment(0xe1, [104, 116, 116, 112]);
    const table = segment(0xdb, [0, 1, 2]);
    expect([...withoutExif(jpeg(app0, gps, table, xmp))]).toEqual([...jpeg(app0, table)]);
  });

  it('leaves alone what it cannot read as JPEG segments', () => {
    const odd = new Uint8Array([1, 2, 3, 4, 5]);
    expect(withoutExif(odd)).toBe(odd);
    const cut = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x10, 0x00, 1]);
    expect(withoutExif(cut)).toBe(cut);
  });
});

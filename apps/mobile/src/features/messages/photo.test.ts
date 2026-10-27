import { photoHashOf, randomUuid } from '@bargu/crypto';

const mockUpload = jest.fn<Promise<void>, [string, Uint8Array]>(() => Promise.resolve());
const mockDownload = jest.fn<Promise<Uint8Array>, [string]>();
jest.mock('./messages-api', () => ({
  messagesApi: {
    upload: (blobId: string, sealed: Uint8Array) => mockUpload(blobId, sealed),
    download: (blobId: string) => mockDownload(blobId),
  },
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));

import {
  forgetPhotoFiles,
  keptFileOf,
  openPhoto,
  sealPhoto,
  sealedFileOf,
  uploadPhoto,
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

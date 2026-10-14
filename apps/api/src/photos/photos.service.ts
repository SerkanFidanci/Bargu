import { HttpStatus, Injectable } from '@nestjs/common';
import { fromBase64url, toBase64url } from '@bargu/crypto';
import type { Photo } from '@bargu/schemas';
import { eq } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { profilePhotos } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';

/**
 * Encrypted profile photos (docs/ADR/0014). The server stores what the phone sealed and hands it
 * to people who share a circle with its owner (row-level security decides); it never has a key.
 */
@Injectable()
export class PhotosService {
  constructor(private readonly database: DatabaseService) {}

  async put(auth: AuthContext, photo: Photo): Promise<void> {
    const ciphertext = fromBase64url(photo.ciphertext);
    await this.database.asUser(auth.userId, (tx) =>
      tx
        .insert(profilePhotos)
        .values({ userId: auth.userId, photoId: photo.photoId, ciphertext })
        .onConflictDoUpdate({
          target: profilePhotos.userId,
          set: { photoId: photo.photoId, ciphertext, updatedAt: new Date() },
        }),
    );
  }

  async remove(auth: AuthContext): Promise<void> {
    await this.database.asUser(auth.userId, (tx) =>
      tx.delete(profilePhotos).where(eq(profilePhotos.userId, auth.userId)),
    );
  }

  /** Someone's photo, if the caller shares a circle with them; otherwise as if there were none. */
  async get(auth: AuthContext, userId: string): Promise<Photo> {
    const [row] = await this.database.asUser(auth.userId, (tx) =>
      tx
        .select({ photoId: profilePhotos.photoId, ciphertext: profilePhotos.ciphertext })
        .from(profilePhotos)
        .where(eq(profilePhotos.userId, userId)),
    );
    if (row === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    return { photoId: row.photoId, ciphertext: toBase64url(row.ciphertext) };
  }
}

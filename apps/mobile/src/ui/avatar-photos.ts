import { create } from 'zustand';

/**
 * Profile photos by user id, as data URIs, for <Avatar>. Filled by features/profile/photo.ts
 * after decrypting on this phone; an avatar without an entry shows its emoji or initial.
 */
export const useAvatarPhotos = create<Record<string, string>>(() => ({}));

import { type CosmeticPass, cosmeticPassReplySchema } from '@bargu/schemas';

import { isApiError } from '../errors';
import { api } from '../auth/auth-store';

/** The account's own cosmetic pass (apps/api, docs/ADR/0025 §1); null without packs or a key. */
export async function fetchPass(): Promise<CosmeticPass | null> {
  try {
    return cosmeticPassReplySchema.parse(await api.authed('/v1/me/cosmetics/pass')).pass;
  } catch (error) {
    // A server without a signing key: no cosmetics there, nothing wrong.
    if (isApiError(error, 'NOT_FOUND')) return null;
    throw error;
  }
}

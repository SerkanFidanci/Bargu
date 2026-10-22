import { inviteHost } from '@/config/invite-host';
import { parseBarguLink } from '@/features/links/incoming-link';

/**
 * The token of a guardian link or QR code, the child's code (apps/api guardians.service
 * guardianLink): `bargu://g/<token>`, the invite page's address with the token in the path, or what
 * the app shares, `https://<invite host>/g#<token>`. Null for anything else (never trusted blindly).
 */
export function guardianTokenFrom(
  scanned: string,
  host: string | undefined = inviteHost,
): string | null {
  const link = parseBarguLink(scanned.trim(), host, false);
  return link?.screen === 'g' ? link.token : null;
}

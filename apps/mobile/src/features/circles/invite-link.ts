import { inviteHost } from '@/config/invite-host';
import { parseBarguLink } from '@/features/links/incoming-link';

/**
 * The token of a Bargu invite link or QR code; null for anything else (never trusted blindly). The
 * app's own `bargu://i/<token>`, the invite page's address with the token in the path, and what the
 * app shares, `https://<invite host>/i#<token>` (apps/api invites.service inviteLink); see
 * features/links/incoming-link.ts for what each form must look like. A guardian code is no invite.
 */
export function inviteTokenFrom(
  scanned: string,
  host: string | undefined = inviteHost,
): string | null {
  const link = parseBarguLink(scanned.trim(), host, false);
  return link?.screen === 'i' ? link.token : null;
}

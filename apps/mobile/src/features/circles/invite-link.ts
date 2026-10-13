import { inviteTokenSchema } from '@bargu/schemas';

/** The app's own invite links (apps/api invites.service inviteLink). */
const INVITE_LINK = /^bargu:\/\/i\/([A-Za-z0-9_-]+)$/;

/** The token of a Bargu invite link or QR code; null for anything else (never trusted blindly). */
export function inviteTokenFrom(scanned: string): string | null {
  const match = INVITE_LINK.exec(scanned.trim());
  const parsed = inviteTokenSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}

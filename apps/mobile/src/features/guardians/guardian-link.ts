import { inviteTokenSchema } from '@bargu/schemas';

/** The child's guardian code as a link (apps/api guardians.service guardianLink). */
const GUARDIAN_LINK = /^bargu:\/\/g\/([A-Za-z0-9_-]+)$/;

/** The token of a guardian link or QR code; null for anything else (never trusted blindly). */
export function guardianTokenFrom(scanned: string): string | null {
  const match = GUARDIAN_LINK.exec(scanned.trim());
  const parsed = inviteTokenSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}

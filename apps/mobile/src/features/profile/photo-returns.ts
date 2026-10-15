import type { Circle, MemberCard } from '@bargu/schemas';

/** A member's photo key as this phone learnt it, and from which of their devices. */
export interface KnownPhotoKey {
  id: string;
  key: string;
  /** The device that sent it; missing for keys learnt before devices were recorded. */
  deviceId?: string | undefined;
}

export interface PhotoReturn {
  userId: string;
  id: string;
  key: string;
}

/** What one profile message can carry (packages/schemas profilePayloadSchema). */
export const MAX_RETURNS = 2;

/**
 * Members of a circle whose phone changed since this phone got their photo key (they reinstalled
 * or moved to a new phone, so their own key is gone): the key goes back to them inside this
 * phone's next profile message. Only to members this phone trusts again (a changed identity is
 * acknowledged first), so a phone that took over an account gets nothing it could not see anyway.
 */
export function returnsFor(
  circle: Circle,
  known: Readonly<Record<string, KnownPhotoKey>>,
  trusted: (member: MemberCard) => boolean,
  me: string | null,
): PhotoReturn[] {
  const returns: PhotoReturn[] = [];
  for (const member of circle.members) {
    const device = member.device?.bundle.deviceId;
    if (member.userId === me || member.status !== 'active' || device === undefined) continue;
    const key = known[member.userId];
    if (key?.deviceId === undefined || key.deviceId === device || !trusted(member)) continue;
    returns.push({ userId: member.userId, id: key.id, key: key.key });
  }
  return returns.slice(0, MAX_RETURNS);
}

/**
 * Keys learnt before devices were recorded belong to the member's current device: nothing to give
 * back for them. Also marks returned keys as delivered to the member's current device.
 */
export function withCurrentDevices(
  known: Readonly<Record<string, KnownPhotoKey>>,
  circles: readonly Circle[],
  only?: ReadonlySet<string>,
): Record<string, KnownPhotoKey> {
  const next = { ...known };
  for (const circle of circles) {
    for (const member of circle.members) {
      const entry = next[member.userId];
      const device = member.device?.bundle.deviceId;
      if (entry === undefined || device === undefined) continue;
      if (only === undefined ? entry.deviceId === undefined : only.has(member.userId)) {
        next[member.userId] = { ...entry, deviceId: device };
      }
    }
  }
  return next;
}

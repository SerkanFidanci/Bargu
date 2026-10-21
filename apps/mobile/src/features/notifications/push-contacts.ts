import { fromBase64url } from '@bargu/crypto';
import type { Circle, GuardianLink } from '@bargu/schemas';
import { z } from 'zod';

import { memberName, partnerOf } from '../circles/names';
import { verifiedBundle } from '../keys/bundle-cache';
import type { KeyStore } from '../keys/key-store';
import type { KeyValueStore } from '../storage/vault';

/**
 * What a notification needs while the app is closed (docs/ADR/0016): who may send this phone a
 * signed notification (their device's identity key, as the app trusts it) and their name; the
 * circles' names; and, for sending, the devices to seal arrivals for. Kept in the encrypted vault
 * (and, on iPhone, the keychain shared with the notification extension); only trusted members.
 */
const contactsSchema = z
  .object({
    devices: z.record(
      z.string(),
      z.object({ userId: z.string(), name: z.string(), identityKey: z.string() }).strict(),
    ),
    circles: z.record(z.string(), z.object({ name: z.string() }).strict()),
    recipients: z.record(
      z.string(),
      z.array(z.object({ userId: z.string(), deviceId: z.string(), dhKey: z.string() }).strict()),
    ),
  })
  .strict();
export type PushContacts = z.infer<typeof contactsSchema>;

export const CONTACTS_KEY = 'push:contacts:v1';
export const EMPTY_CONTACTS: PushContacts = { devices: {}, circles: {}, recipients: {} };

/** The contacts for the circles as they are now (trusted, active members of active circles). */
export function contactsOf(
  circles: readonly Circle[],
  keys: KeyStore,
  me: string | null,
  /** Guardian notices name a link: a parent's links are named after the child (docs/ADR/0023). */
  links: readonly GuardianLink[] = [],
): PushContacts {
  const contacts: PushContacts = { devices: {}, circles: {}, recipients: {} };
  for (const link of links) {
    if (link.role !== 'guardian' || link.status !== 'active') continue;
    contacts.circles[link.id] = { name: link.other.displayName ?? `@${link.other.username}` };
  }
  for (const circle of circles) {
    if (circle.myStatus !== 'active') continue;
    // A friendship is called after the friend; a group by its name.
    const partner = partnerOf(circle, me);
    contacts.circles[circle.id] = {
      name: partner === undefined ? (circle.name ?? '') : memberName(partner),
    };
    const recipients: PushContacts['recipients'][string] = [];
    for (const member of circle.members) {
      if (member.userId === me || member.status !== 'active' || member.device === null) continue;
      if (!keys.trusted(member)) continue;
      const bundle = member.device.bundle;
      try {
        verifiedBundle(bundle);
      } catch {
        continue;
      }
      contacts.devices[bundle.deviceId] = {
        userId: member.userId,
        name: memberName(member),
        identityKey: bundle.identityKey,
      };
      recipients.push({ userId: member.userId, deviceId: bundle.deviceId, dhKey: bundle.dhKey });
    }
    contacts.recipients[circle.id] = recipients;
  }
  return contacts;
}

export function saveContacts(store: KeyValueStore, contacts: PushContacts): void {
  store.set(CONTACTS_KEY, JSON.stringify(contacts));
}

export function loadContacts(store: KeyValueStore): PushContacts {
  const raw = store.get(CONTACTS_KEY);
  if (raw === undefined) return EMPTY_CONTACTS;
  const parsed = contactsSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : EMPTY_CONTACTS;
}

/** A sender's identity key as the app trusts it, for openPush (null: unknown device). */
export function identityOf(contacts: PushContacts, deviceId: string): Uint8Array | null {
  const known = contacts.devices[deviceId];
  return known === undefined ? null : fromBase64url(known.identityKey, 32);
}

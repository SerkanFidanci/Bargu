import {
  type AccountExport,
  type AgeState,
  type GuardianLink,
  HISTORY_KEEP_MS,
} from '@bargu/schemas';
import { Directory } from 'expo-file-system';

import type { TracePoint } from '../history/trail-model';
import type { SharingSettings } from '../location/sharing';
import type { Place } from '../places/place-model';
import type { Doc } from '../plan/plan-model';
import type { Status } from '../social/status';

/** What this phone adds to the server's copy, opened here (docs/ADR/0022). */
export interface PhoneHeld {
  sharing: SharingSettings;
  places: readonly Place[];
  docs: readonly Doc[];
  myTrail: readonly TracePoint[];
  status: Status | null;
}

/**
 * "Verilerimi indir": the account's own data in one JSON file. The server's part as it holds it;
 * this phone's part opened here: its own location history, the places and event documents of its
 * circles, its choices. Nobody else's location or history (not the user's data).
 */
export function exportFile(
  server: AccountExport,
  phone: PhoneHeld,
  now: number,
  age: AgeState['age'] = null,
  guardians: readonly GuardianLink[] = [],
) {
  return {
    format: 'bargu-export',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    account: server.account,
    ageBand: age === null ? null : { band: age.band, method: age.method, at: age.at },
    // docs/ADR/0023 §4: the parent links, as this account is in them.
    guardianLinks: guardians.map((link) => ({
      role: link.role,
      status: link.status,
      other: link.other.username,
      createdAt: new Date(link.createdAt).toISOString(),
      activeAt: link.activeAt === null ? null : new Date(link.activeAt).toISOString(),
      endRequestedAt:
        link.endRequestedAt === null ? null : new Date(link.endRequestedAt).toISOString(),
    })),
    devices: server.devices,
    circles: server.circles,
    securityEvents: server.securityEvents,
    passkeys: server.passkeys,
    pushRegistered: server.pushRegistered,
    locationHistoryPiecesOnServer: server.historyPieces,
    privacy: server.privacy,
    onThisPhone: {
      sharing: phone.sharing,
      places: phone.places.map(({ id, circleId, name, emoji, lat, lng, radius }) => ({
        id,
        circleId,
        name,
        emoji,
        lat,
        lng,
        radius,
      })),
      eventDocuments: phone.docs.map((doc) => ({ circleId: doc.circleId, ...doc.payload })),
      myLocationHistory: phone.myTrail.map((point) => ({
        at: new Date(point.at).toISOString(),
        lat: point.lat,
        lng: point.lng,
        accuracyM: point.acc,
      })),
      status: phone.status,
    },
  };
}

/** The window of the own trail the phone keeps (as long as the server keeps history). */
export const trailWindow = (now: number) => ({ from: now - HISTORY_KEEP_MS, to: now });

export const exportName = (now: number) =>
  `bargu-verilerim-${new Date(now).toISOString().slice(0, 10)}.json`;

/**
 * Saves the file where the user picks (Android's folder picker, the iOS document picker): no other
 * app is involved. False when the user cancelled.
 */
export async function saveExport(name: string, json: string): Promise<boolean> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  const file = folder.createFile(name, 'application/json');
  file.write(json);
  return true;
}

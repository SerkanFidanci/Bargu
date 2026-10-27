import { revealChatItem, revealDirectItem, toBase64url } from '@bargu/crypto';
import type { Circle, ReportReason, ReportRequest } from '@bargu/schemas';

import { useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { verifiedBundle } from '../keys/bundle-cache';
import { keys } from '../live/live-session';
import { queryClient } from '../query-client';
import type { ChatItem } from './messages';
import { messagesApi } from './messages-api';
import { keptFileOf } from './photo';

/**
 * "Bildir" (docs/ADR/0035 §9): of an item, with that one item's own key and nonce (never a
 * circle's or a person's key), so the server can check it came from its sender and read only it;
 * of a person, without an item. The user is told first that the item's words go to Bargu.
 */
export async function report(
  input: { item: ChatItem; reason: ReportReason } | { userId: string; reason: ReportReason },
): Promise<boolean> {
  const request: ReportRequest | null =
    'item' in input
      ? itemReport(input.item, input.reason)
      : { userId: input.userId, reason: input.reason };
  if (request === null) return false;
  try {
    await messagesApi.report(request);
    return true;
  } catch {
    return false;
  }
}

/** The report of one item, or null when this phone cannot open it again (then it is not sent). */
function itemReport(item: ChatItem, reason: ReportReason): ReportRequest | null {
  const envelope = item.envelope;
  const device = useAuth.getState().device;
  if (envelope === undefined || device === null) return null;
  const circles = queryClient.getQueryData<Circle[]>(circlesKey) ?? [];
  const member = circles
    .flatMap((circle) => circle.members)
    .find(
      (candidate) =>
        candidate.userId === item.from &&
        candidate.device?.bundle.deviceId === envelope.senderDeviceId,
    );
  if (member?.device === undefined || member.device === null) return null;
  try {
    const sender = verifiedBundle(member.device.bundle);
    const store = keys();
    let key: { key: string; nonce: string };
    if ('circleId' in envelope) {
      const chatKey = store.chatKey(envelope.circleId, envelope.epoch, envelope.senderDeviceId);
      if (chatKey === null) return null;
      key = revealChatItem({ envelope, chatKey, sender });
    } else {
      key = revealDirectItem({ envelope, recipient: device, sender });
    }
    // A photo's file too when this phone has it at hand; else the server uses the one it keeps.
    const file = item.photo === undefined ? undefined : keptFileOf(item.photo.blobId);
    return {
      userId: item.from,
      reason,
      item: { envelope, ...key },
      ...(file === undefined ? {} : { file: toBase64url(file) }),
    };
  } catch {
    return null;
  }
}

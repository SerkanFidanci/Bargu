import { decryptChat, type DevicePublicKeys, type SenderKey } from '@bargu/crypto';
import type { ChatEnvelope, Circle, Rollcall } from '@bargu/schemas';

/**
 * An event's roll call as this phone believes it (docs/ADR/0040): only what it could open and
 * check. The question must be sealed by an owner's device as a `rollcall` for this id; an answer
 * counts only if it is that member's own sealed `here` for this roll call. The server could leave
 * one out, never make one up.
 */
export interface CheckedRollcall {
  id: string;
  circleId: string;
  startedBy: string;
  startedAt: number;
  closesAt: number;
  closedAt: number | null;
  eligible: readonly string[];
  outCount: number;
  /** Who said "Buradayım", and when (only answers this phone could check). */
  here: Readonly<Record<string, number>>;
}

/** What opening needs: the circle's chat keys and the members' checked device keys. */
export interface RollcallKeys {
  chatKey(circleId: string, epoch: number, senderDeviceId: string): SenderKey | null;
  /** The device keys of this member's device, if this phone trusts it; null otherwise. */
  sender(userId: string, deviceId: string): DevicePublicKeys | null;
}

function open(envelope: ChatEnvelope, from: string, keys: RollcallKeys, now: number) {
  const sender = keys.sender(from, envelope.senderDeviceId);
  const chatKey = keys.chatKey(envelope.circleId, envelope.epoch, envelope.senderDeviceId);
  if (sender === null || chatKey === null) return null;
  try {
    return decryptChat({ envelope, chatKey, sender, now });
  } catch {
    return null;
  }
}

/**
 * The roll call checked, or null if its question cannot be opened as an owner's (a forgery, or
 * keys this phone has yet to get). `owners`: the circle's owners as this phone knows them.
 */
export function checkRollcall(
  rollcall: Rollcall,
  owners: ReadonlySet<string>,
  keys: RollcallKeys,
  now: number,
): CheckedRollcall | null {
  if (!owners.has(rollcall.startedBy) || rollcall.envelope.circleId !== rollcall.circleId) {
    return null;
  }
  const question = open(rollcall.envelope, rollcall.startedBy, keys, now);
  if (question?.kind !== 'rollcall' || question.id !== rollcall.id) return null;
  const eligible = new Set(rollcall.eligible);
  const here: Record<string, number> = {};
  for (const answer of rollcall.answers) {
    if (!eligible.has(answer.userId) || answer.envelope.circleId !== rollcall.circleId) continue;
    const said = open(answer.envelope, answer.userId, keys, now);
    if (said?.kind === 'here' && said.rollcallId === rollcall.id) here[answer.userId] = answer.at;
  }
  return {
    id: rollcall.id,
    circleId: rollcall.circleId,
    startedBy: rollcall.startedBy,
    startedAt: rollcall.startedAt,
    // Never open longer than ten minutes from its own question, whatever the server says.
    closesAt: Math.min(rollcall.closesAt, question.closesAt),
    closedAt: rollcall.closedAt,
    eligible: rollcall.eligible,
    outCount: rollcall.outCount,
    here,
  };
}

/** Open: not ended by an owner, and its ten minutes not over. */
export function isOpen(rollcall: CheckedRollcall, now: number): boolean {
  return rollcall.closedAt === null && rollcall.closesAt > now;
}

/** The circle's owners (its admins), as the circle says. */
export function ownersOf(circle: Pick<Circle, 'members'>): Set<string> {
  return new Set(
    circle.members.filter((member) => member.role === 'owner').map((member) => member.userId),
  );
}

/** Who may answer and has not (yet). */
export function notAnswered(rollcall: CheckedRollcall): string[] {
  return rollcall.eligible.filter((userId) => rollcall.here[userId] === undefined);
}

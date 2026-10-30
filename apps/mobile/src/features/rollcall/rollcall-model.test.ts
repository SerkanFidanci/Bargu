import {
  chatKeyOf,
  type DeviceKeys,
  encryptChat,
  exportDeviceKeyBundle,
  generateDeviceKeys,
  generateSenderKey,
  randomUuid,
  type SenderKey,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import { type ChatPayload, ROLLCALL, type Rollcall } from '@bargu/schemas';

import { checkRollcall, isOpen, notAnswered, type RollcallKeys } from './rollcall-model';

const NOW = 1_800_000_000_000;
const EPOCH = 3;
const circleId = randomUuid();

interface Person {
  userId: string;
  device: DeviceKeys;
  senderKey: SenderKey;
}
const somebody = (): Person => {
  const device = generateDeviceKeys(randomUuid());
  return {
    userId: randomUuid(),
    device,
    senderKey: generateSenderKey({ circleId, epoch: EPOCH, senderDeviceId: device.deviceId }),
  };
};
const owner = somebody();
const ali = somebody();
const ece = somebody();
const outsider = somebody();
const people = [owner, ali, ece, outsider];

/** This phone has everyone's keys but the outsider's (not a member). */
const keys: RollcallKeys = {
  chatKey: (_circle, _epoch, deviceId) => {
    const who = people.find((person) => person.device.deviceId === deviceId);
    return who === undefined || who === outsider ? null : chatKeyOf(who.senderKey);
  },
  sender: (userId, deviceId) => {
    const who = people.find((person) => person.userId === userId);
    if (who?.device.deviceId !== deviceId) return null;
    return verifyDeviceKeyBundle(exportDeviceKeyBundle(who.device));
  },
};

const seal = (who: Person, payload: ChatPayload) =>
  encryptChat({ senderKey: who.senderKey, sender: who.device, payload });

function rollcallOf(overrides: Partial<Rollcall> = {}, question?: Person): Rollcall {
  const id = overrides.id ?? randomUuid();
  return {
    id,
    circleId,
    startedBy: owner.userId,
    startedAt: NOW,
    closesAt: NOW + ROLLCALL.openMs,
    closedAt: null,
    eligible: [ali.userId, ece.userId],
    outCount: 1,
    envelope: seal(question ?? owner, {
      kind: 'rollcall',
      id,
      closesAt: NOW + ROLLCALL.openMs,
      ts: NOW,
    }),
    answers: [],
    ...overrides,
  };
}
const here = (who: Person, rollcallId: string, at = NOW + 1_000) => ({
  userId: who.userId,
  at,
  envelope: seal(who, { kind: 'here', id: randomUuid(), rollcallId, ts: at }),
});
const owners = new Set([owner.userId]);

describe('a roll call as the phone believes it (docs/ADR/0040)', () => {
  it("counts each member's own sealed answer, and who has not answered", () => {
    const base = rollcallOf();
    const checked = checkRollcall({ ...base, answers: [here(ali, base.id)] }, owners, keys, NOW);
    expect(checked?.here).toEqual({ [ali.userId]: NOW + 1_000 });
    expect(checked === null ? [] : notAnswered(checked)).toEqual([ece.userId]);
    expect(checked?.outCount).toBe(1);
  });

  it('takes no answer the server made up or moved', () => {
    const base = rollcallOf();
    const other = rollcallOf();
    const checked = checkRollcall(
      {
        ...base,
        answers: [
          // Ece's sealed answer, claimed to be Ali's.
          { ...here(ece, base.id), userId: ali.userId },
          // Ece's answer to another roll call.
          here(ece, other.id),
          // Someone it did not ask.
          here(outsider, base.id),
        ],
      },
      owners,
      keys,
      NOW,
    );
    expect(checked?.here).toEqual({});
  });

  it('takes a question only from an owner, sealed for this very roll call', () => {
    // Asked by a member who is no owner.
    expect(checkRollcall(rollcallOf({ startedBy: ali.userId }, ali), owners, keys, NOW)).toBeNull();
    // An owner's question for another roll call, under this id.
    const other = rollcallOf();
    expect(checkRollcall(rollcallOf({ envelope: other.envelope }), owners, keys, NOW)).toBeNull();
  });

  it('is open for its ten minutes or until an owner ends it, never longer than its question says', () => {
    const open = checkRollcall(rollcallOf(), owners, keys, NOW);
    if (open === null) throw new Error('not checked');
    expect(isOpen(open, NOW + ROLLCALL.openMs - 1)).toBe(true);
    expect(isOpen(open, NOW + ROLLCALL.openMs)).toBe(false);
    const ended = checkRollcall(rollcallOf({ closedAt: NOW + 5_000 }), owners, keys, NOW);
    if (ended === null) throw new Error('not checked');
    expect(isOpen(ended, NOW + 6_000)).toBe(false);
    // A server saying it stays open for an hour: the question's ten minutes win.
    const longer = checkRollcall(rollcallOf({ closesAt: NOW + 3_600_000 }), owners, keys, NOW);
    expect(longer?.closesAt).toBe(NOW + ROLLCALL.openMs);
  });
});

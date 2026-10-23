import { generateDeviceKeys, randomUuid, voteId } from '@bargu/crypto';
import type { DocPayload, PlanPayload } from '@bargu/schemas';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/ui/toast', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
// The vault is a native module (MMKV): here a map. It holds the spots this phone added.
const mockVault = new Map<string, string>();
jest.mock('../storage/vault', () => ({
  isVaultOpen: () => true,
  vault: () => ({
    get: (key: string) => mockVault.get(key),
    set: (key: string, value: string) => {
      mockVault.set(key, value);
    },
    delete: (key: string) => {
      mockVault.delete(key);
    },
    keys: () => [...mockVault.keys()],
  }),
}));
// What the actions ask of the documents and the places: recorded, always granted.
const mockSave = jest.fn<Promise<'saved'>, [string, DocPayload, object?]>(() =>
  Promise.resolve('saved'),
);
const mockRemove = jest.fn<Promise<boolean>, [string, string]>(() => Promise.resolve(true));
const mockForget = jest.fn<Promise<boolean>, [{ id: string }]>(() => Promise.resolve(true));
jest.mock('./docs-session', () => ({
  docs: {
    save: (circleId: string, doc: DocPayload, options?: object) =>
      mockSave(circleId, doc, ...(options === undefined ? [] : [options])),
    remove: (circleId: string, id: string) => mockRemove(circleId, id),
  },
}));
jest.mock('../places/places-session', () => ({
  places: { remove: (place: { id: string }) => mockForget(place) },
}));
// Who has a phone in the circle, and what this phone seals for them (the notice's body, readable).
const mockRecipients: { userId: string; deviceId: string; dhKey: string }[] = [];
jest.mock('../notifications/push-contacts', () => ({
  loadContacts: () => ({
    devices: {},
    circles: {},
    recipients: { '00000000-0000-4000-8000-000000000001': mockRecipients },
  }),
}));
jest.mock('../places/presence', () => ({
  sealPushes: (
    recipients: { userId: string; deviceId: string }[],
    _device: unknown,
    body: unknown,
  ) => recipients.map((recipient) => ({ ...recipient, sealed: JSON.stringify(body) })),
}));

import { useAuth } from '../auth/auth-store';
import { usePlaces } from '../places/places';
import { docKey, useDocs } from './docs';
import { rememberSpot } from './my-spots';
import { answerMeeting, endMeeting, keepMeetingPlace, setMeeting } from './plan-actions';

const CIRCLE = '00000000-0000-4000-8000-000000000001';
const ME = '00000000-0000-4000-8000-000000000002';
const ADDED = '00000000-0000-4000-8000-0000000000aa';
const HOME = '00000000-0000-4000-8000-0000000000bb';

function holdMeeting(plan: Partial<PlanPayload>): void {
  const payload: PlanPayload = { kind: 'plan', id: CIRCLE, meetAt: 1, by: ME, ts: 1, ...plan };
  useDocs.setState(
    {
      [docKey(CIRCLE, CIRCLE)]: {
        circleId: CIRCLE,
        version: 1,
        shared: true,
        // Its first version is signed by its starter (QA-35).
        authorId: payload.by ?? ME,
        payload,
      },
    },
    true,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  const place = (id: string, name: string) => ({
    id,
    circleId: CIRCLE,
    version: 1,
    name,
    emoji: '📍',
    lat: 41,
    lng: 29,
    radius: 100,
    ts: 1,
  });
  usePlaces.setState({ [ADDED]: place(ADDED, 'Woh date'), [HOME]: place(HOME, 'Ev') }, true);
  // This phone added "Woh date" for its meeting.
  mockVault.clear();
  rememberSpot(ADDED);
});

describe('the place added for a meeting (docs/ADR/0026 Ek 1)', () => {
  it('goes when the meeting is ended', async () => {
    holdMeeting({ placeId: ADDED, placeGoes: true });
    expect(await endMeeting(CIRCLE)).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith(CIRCLE, CIRCLE);
    expect(mockForget).toHaveBeenCalledWith(expect.objectContaining({ id: ADDED }));
  });

  it('stays when its starter keeps it: the plan says so before the meeting goes', async () => {
    holdMeeting({ placeId: ADDED, placeGoes: true });
    expect(await endMeeting(CIRCLE, true)).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(CIRCLE, expect.objectContaining({ placeGoes: false }));
    expect(mockSave.mock.invocationCallOrder[0]).toBeLessThan(
      mockRemove.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockForget).not.toHaveBeenCalled();
  });

  it('never takes away a place the circle had before', async () => {
    holdMeeting({ placeId: HOME });
    await endMeeting(CIRCLE);
    expect(mockForget).not.toHaveBeenCalled();
    await keepMeetingPlace(CIRCLE, true);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('goes when the meeting moves to another place, which then stays', async () => {
    holdMeeting({ placeId: ADDED, placeGoes: true });
    expect(await setMeeting(CIRCLE, { placeId: HOME })).toBe(true);
    const saved = mockSave.mock.calls[0]?.[1];
    expect(saved).toMatchObject({ placeId: HOME });
    expect(saved).not.toHaveProperty('placeGoes');
    expect(mockForget).toHaveBeenCalledWith(expect.objectContaining({ id: ADDED }));
  });

  it('moves to a spot picked on the map, which goes with it in turn (the owner, 2026-10-23)', async () => {
    holdMeeting({ placeId: ADDED, placeGoes: true });
    const spot = '00000000-0000-4000-8000-0000000000cc';
    expect(await setMeeting(CIRCLE, { placeId: spot, spot: true })).toBe(true);
    expect(mockSave.mock.calls[0]?.[1]).toMatchObject({ placeId: spot, placeGoes: true });
    expect(mockForget).toHaveBeenCalledWith(expect.objectContaining({ id: ADDED }));
    // From a place the circle had, too: that one stays.
    mockSave.mockClear();
    mockForget.mockClear();
    holdMeeting({ placeId: HOME });
    await setMeeting(CIRCLE, { placeId: spot, spot: true });
    expect(mockSave.mock.calls[0]?.[1]).toMatchObject({ placeId: spot, placeGoes: true });
    expect(mockForget).not.toHaveBeenCalled();
  });

  it('never takes a place this phone did not add, whatever the plan says (QA-35)', async () => {
    // Someone who may write the plan said the circle's "Ev" goes with the meeting.
    holdMeeting({ placeId: HOME, placeGoes: true });
    expect(await endMeeting(CIRCLE)).toBe(true);
    holdMeeting({ placeId: HOME, placeGoes: true });
    await setMeeting(CIRCLE, { placeId: ADDED });
    expect(mockForget).not.toHaveBeenCalled();
  });

  it('is kept or let go with the switch, and a new time keeps the choice', async () => {
    holdMeeting({ placeId: ADDED, placeGoes: true });
    await keepMeetingPlace(CIRCLE, true);
    expect(mockSave).toHaveBeenLastCalledWith(
      CIRCLE,
      expect.objectContaining({ placeGoes: false }),
    );
    await setMeeting(CIRCLE, { meetAt: 2 });
    expect(mockSave).toHaveBeenLastCalledWith(
      CIRCLE,
      expect.objectContaining({ meetAt: 2, placeGoes: true }),
      expect.anything(),
    );
    expect(mockForget).not.toHaveBeenCalled();
  });
});

const STARTER = '00000000-0000-4000-8000-000000000003';
const OTHER = '00000000-0000-4000-8000-000000000004';
const CANNOT = '00000000-0000-4000-8000-000000000005';

function holdAnswer(userId: string, choice: number): void {
  const id = voteId(CIRCLE, userId);
  const payload: DocPayload = { kind: 'vote', id, pollId: CIRCLE, choices: [choice], ts: 1 };
  useDocs.setState({
    [docKey(CIRCLE, id)]: {
      circleId: CIRCLE,
      version: 1,
      shared: false,
      authorId: userId,
      payload,
    },
  });
}

/** Whom the notices of a save went to, and what they said. */
function noticesOf(call: number): { to: string[]; body: Record<string, unknown> | null } {
  const options = mockSave.mock.calls[call]?.[2] as
    { pushes?: { userId: string; sealed: string }[]; moved?: boolean } | undefined;
  const pushes = options?.pushes ?? [];
  const first = pushes[0];
  return {
    to: pushes.map((push) => push.userId),
    body: first === undefined ? null : (JSON.parse(first.sealed) as Record<string, unknown>),
  };
}

describe('answers to a meeting (docs/ADR/0026 Ek 2)', () => {
  beforeEach(() => {
    useAuth.setState({ userId: ME, device: generateDeviceKeys(randomUuid()) });
    mockRecipients.splice(0, mockRecipients.length);
    for (const userId of [STARTER, OTHER, CANNOT]) {
      mockRecipients.push({ userId, deviceId: `device-${userId}`, dhKey: 'x' });
    }
  });

  it('are a vote on the meeting, in place, and its starter hears how many come', async () => {
    holdMeeting({ placeId: HOME, by: STARTER });
    holdAnswer(OTHER, 0);
    expect(await answerMeeting(CIRCLE, 'maybe')).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      CIRCLE,
      { kind: 'vote', id: voteId(CIRCLE, ME), pollId: CIRCLE, choices: [1], ts: 0 },
      expect.objectContaining({ pushes: expect.any(Array) as unknown }),
    );
    const sent = noticesOf(0);
    expect(sent.to).toEqual([STARTER]);
    expect(sent.body).toMatchObject({ kind: 'meetingAnswer', answer: 1, going: 1, maybe: 1 });
  });

  it('tell nobody when the starter answers their own meeting', async () => {
    holdMeeting({ placeId: HOME, by: ME });
    await answerMeeting(CIRCLE, 'going');
    expect(noticesOf(0).to).toEqual([]);
  });

  it('hear a moved meeting: those who said they come, not who cannot, nor this user', async () => {
    holdMeeting({ placeId: HOME, by: STARTER });
    holdAnswer(OTHER, 0);
    holdAnswer(CANNOT, 2);
    holdAnswer(ME, 0);
    await setMeeting(CIRCLE, { meetAt: 2 });
    const sent = noticesOf(0);
    expect(sent.to).toEqual([OTHER]);
    expect(sent.body).toMatchObject({ kind: 'meetingMoved', name: 'Ev', meetAt: 2 });
    expect(mockSave.mock.calls[0]?.[2]).toMatchObject({ moved: true });
    // Nothing moved (the same time again): no notice.
    mockSave.mockClear();
    await setMeeting(CIRCLE, { meetAt: 1 });
    expect(noticesOf(0).to).toEqual([]);
  });
});

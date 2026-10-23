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
// The vault is a native module (MMKV): here a map.
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
const mockPlaceSave = jest.fn<Promise<'saved'>, [string, object]>(() => Promise.resolve('saved'));
jest.mock('./docs-session', () => ({
  docs: {
    save: (circleId: string, doc: DocPayload, options?: object) =>
      mockSave(circleId, doc, ...(options === undefined ? [] : [options])),
    remove: (circleId: string, id: string) => mockRemove(circleId, id),
  },
}));
jest.mock('../places/places-session', () => ({
  places: {
    remove: (place: { id: string }) => mockForget(place),
    save: (circleId: string, place: object) => mockPlaceSave(circleId, place),
  },
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
import { answerMeeting, endMeeting, setMeeting, startMeeting } from './plan-actions';

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
});

const SPOT = { name: 'Taksim', lat: 41.037, lng: 28.985, radius: 250 };

describe('a spot picked on the map for a meeting (docs/ADR/0026 Ek 1, QA-36)', () => {
  it('lives in the meeting only: starting, moving and ending save or delete no place', async () => {
    useAuth.setState({ userId: ME, device: generateDeviceKeys(randomUuid()) });
    expect(await startMeeting({ id: CIRCLE }, { spot: SPOT, meetAt: 5 })).toBe(true);
    const started = mockSave.mock.calls[0]?.[1];
    expect(started).toMatchObject({ kind: 'plan', id: CIRCLE, spot: SPOT, meetAt: 5, by: ME });
    expect(started).not.toHaveProperty('placeId');
    holdMeeting({ spot: SPOT });
    expect(await setMeeting(CIRCLE, { meetAt: 9 })).toBe(true);
    expect(mockSave.mock.calls[1]?.[1]).toMatchObject({ spot: SPOT, meetAt: 9 });
    expect(await endMeeting(CIRCLE)).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith(CIRCLE, CIRCLE);
    expect(mockPlaceSave).not.toHaveBeenCalled();
    expect(mockForget).not.toHaveBeenCalled();
  });

  it('is either a saved place or a spot: picking one drops the other', async () => {
    holdMeeting({ placeId: HOME });
    await setMeeting(CIRCLE, { spot: SPOT });
    expect(mockSave.mock.calls[0]?.[1]).toMatchObject({ spot: SPOT });
    expect(mockSave.mock.calls[0]?.[1]).not.toHaveProperty('placeId');
    holdMeeting({ spot: SPOT });
    await setMeeting(CIRCLE, { placeId: HOME });
    expect(mockSave.mock.calls[1]?.[1]).toMatchObject({ placeId: HOME });
    expect(mockSave.mock.calls[1]?.[1]).not.toHaveProperty('spot');
    expect(mockForget).not.toHaveBeenCalled();
  });

  it('becomes a saved place only by "Bitir, yeri sakla", before the meeting goes', async () => {
    holdMeeting({ spot: SPOT });
    expect(await endMeeting(CIRCLE, true)).toBe(true);
    expect(mockPlaceSave).toHaveBeenCalledWith(
      CIRCLE,
      expect.objectContaining({ name: 'Taksim', lat: SPOT.lat, lng: SPOT.lng, radius: 250 }),
    );
    expect(mockPlaceSave.mock.invocationCallOrder[0]).toBeLessThan(
      mockRemove.mock.invocationCallOrder[0] ?? 0,
    );
    // The ending failed after the place was kept: tried again, the place is not saved twice.
    mockPlaceSave.mockClear();
    mockRemove.mockResolvedValueOnce(false);
    holdMeeting({ spot: SPOT });
    expect(await endMeeting(CIRCLE, true)).toBe(false);
    expect(mockPlaceSave).toHaveBeenCalledTimes(1);
    usePlaces.setState({
      kept: { ...SPOT, id: 'kept', circleId: CIRCLE, version: 1, emoji: '📍', ts: 2 },
    });
    expect(await endMeeting(CIRCLE, true)).toBe(true);
    expect(mockPlaceSave).toHaveBeenCalledTimes(1);
    // A meeting at a saved place keeps nothing more.
    mockPlaceSave.mockClear();
    holdMeeting({ placeId: HOME });
    await endMeeting(CIRCLE, true);
    expect(mockPlaceSave).not.toHaveBeenCalled();
  });

  it('never lets a plan delete or touch a saved place, whatever it says (QA-35, QA-36)', async () => {
    // Someone who may write the plan names the circle's "Ev", with what an older app wrote.
    holdMeeting({ placeId: HOME, ...({ placeGoes: true } as object) });
    await setMeeting(CIRCLE, { placeId: ADDED });
    await endMeeting(CIRCLE);
    expect(mockForget).not.toHaveBeenCalled();
    expect(mockPlaceSave).not.toHaveBeenCalled();
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

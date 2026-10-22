import type { PlanPayload } from '@bargu/schemas';

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
// The vault is a native module (MMKV); these actions only read contacts from it when starting.
jest.mock('../storage/vault', () => ({
  vault: () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
    keys: () => [],
  }),
}));
// What the actions ask of the documents and the places: recorded, always granted.
const mockSave = jest.fn<Promise<'saved'>, [string, PlanPayload]>(() => Promise.resolve('saved'));
const mockRemove = jest.fn<Promise<boolean>, [string, string]>(() => Promise.resolve(true));
const mockForget = jest.fn<Promise<boolean>, [{ id: string }]>(() => Promise.resolve(true));
jest.mock('./docs-session', () => ({
  docs: {
    save: (circleId: string, plan: PlanPayload) => mockSave(circleId, plan),
    remove: (circleId: string, id: string) => mockRemove(circleId, id),
  },
}));
jest.mock('../places/places-session', () => ({
  places: { remove: (place: { id: string }) => mockForget(place) },
}));

import { usePlaces } from '../places/places';
import { docKey, useDocs } from './docs';
import { endMeeting, keepMeetingPlace, setMeeting } from './plan-actions';

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
        authorId: ME,
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
    );
    expect(mockForget).not.toHaveBeenCalled();
  });
});

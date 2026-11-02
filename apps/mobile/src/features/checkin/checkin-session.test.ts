import type { CheckinList, CheckinReply } from '@bargu/schemas';

import { circlesKey } from '../circles/circle-cache';
import { circleOf, exchangeKeys, type Person, somebody } from '../location/test-support';
import { queryClient } from '../query-client';
import {
  closeChecksBeforeSignOut,
  planTick,
  startCheck,
  startPlan,
  syncChecks,
  useOwnChecks,
} from './checkin-session';

// The phone the module acts as (its keys, vault and account), and what the server answers.
let mockPhone: Person;
const mockCreate = jest.fn<Promise<CheckinReply>, [string, number, unknown]>();
const mockCancel = jest.fn<Promise<CheckinReply>, [string]>(() => Promise.resolve({ ok: true }));
const mockList = jest.fn<Promise<CheckinList>, []>(() => Promise.resolve({ checkins: [] }));
jest.mock('./checkin-api', () => ({
  checkinApi: {
    create: (id: string, openAt: number, boxes: unknown) => mockCreate(id, openAt, boxes),
    cancel: (id: string) => mockCancel(id),
    list: () => mockList(),
    inbox: () => Promise.resolve({ alerts: [] }),
  },
}));
jest.mock('./checkin-reminders', () => ({
  scheduleDue: () => Promise.resolve(),
  cancelDue: () => Promise.resolve(),
  hideOpenNotice: () => Promise.resolve(),
  cancelAllDue: () => Promise.resolve(),
}));
jest.mock('../messages/outbox', () => ({ sendCheckinLine: jest.fn() }));
jest.mock('../auth/auth-store', () => ({
  useAuth: { getState: () => ({ userId: mockPhone.userId, device: mockPhone.device }) },
  onSignedOut: jest.fn(),
}));
jest.mock('../live/live-session', () => ({
  keys: () => mockPhone.keys,
  onOnline: jest.fn(),
  onServerEvents: jest.fn(),
}));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => true, vault: () => mockPhone.store }));
jest.mock('../location/engine', () => ({ useMyFix: { getState: () => ({ fix: null }) } }));
// The battery's native module is not there on Linux (CI): half full, not charging.
jest.mock('expo-battery', () => ({
  getPowerStateAsync: () => Promise.resolve({ batteryLevel: 0.5, batteryState: 1 }),
  BatteryState: { UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
}));

const HOUR = 3_600_000;
const lost = () => Promise.reject(new Error('timeout'));
let ayse: Person;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 10, 2, 18, 0) });
  mockCreate.mockReset();
  mockCancel.mockClear();
  mockList.mockReset().mockResolvedValue({ checkins: [] });
  mockPhone = somebody();
  ayse = somebody();
  const circle = circleOf([mockPhone, ayse]);
  exchangeKeys(circle, [mockPhone, ayse]);
  queryClient.setQueryData(circlesKey, [circle]);
  useOwnChecks.setState({ checks: [], plans: [], pending: [], unsure: [] });
});
afterEach(() => {
  jest.useRealTimers();
});

const check = () => ({
  due: Date.now() + HOUR,
  grace: 10 as const,
  place: null,
  recipients: [ayse.userId],
});

/** Runs a call to its end, letting the waits between its tries go by. */
async function settled<T>(promise: Promise<T>): Promise<T> {
  await jest.advanceTimersByTimeAsync(10_000);
  return promise;
}

describe('setting an arrival check when answers get lost (QA-44 Orta 3)', () => {
  it('asks again with the same id, and keeps one check', async () => {
    mockCreate.mockImplementationOnce(lost).mockResolvedValue({ ok: true });
    expect(await settled(startCheck(check()))).toBe('ok');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const [first, second] = mockCreate.mock.calls.map(([id]) => id);
    expect(second).toBe(first);
    expect(useOwnChecks.getState().checks.map((each) => each.id)).toEqual([first]);
    expect(useOwnChecks.getState().unsure).toEqual([]);
  });

  it('keeps an id whose answer never came, and the next sync cancels it on the server', async () => {
    mockCreate.mockImplementation(lost);
    expect(await settled(startCheck(check()))).toBe('failed');
    const [id] = useOwnChecks.getState().unsure.map((each) => each.id);
    expect(id).toBeDefined();
    expect(new Set(mockCreate.mock.calls.map(([sent]) => sent))).toEqual(new Set([id]));
    // The server took it after all.
    mockList.mockResolvedValue({
      checkins: [{ id: id ?? '', openAt: Date.now() + HOUR, firedAt: null, recipients: [] }],
    });
    await syncChecks();
    expect(mockCancel).toHaveBeenCalledWith(id);
    expect(useOwnChecks.getState().checks).toEqual([]);
  });

  it('cancels a check the server holds that this phone does not know, never a fired one', async () => {
    mockCreate.mockResolvedValue({ ok: true });
    await settled(startCheck(check()));
    const [mine] = useOwnChecks.getState().checks.map((each) => each.id);
    const stray = '0190f7a4-0000-7000-8000-00000000000a';
    const fired = '0190f7a4-0000-7000-8000-00000000000b';
    mockList.mockResolvedValue({
      checkins: [
        { id: mine ?? '', openAt: Date.now() + HOUR, firedAt: null, recipients: [] },
        { id: stray, openAt: Date.now() + HOUR, firedAt: null, recipients: [] },
        { id: fired, openAt: Date.now() - HOUR, firedAt: Date.now() - HOUR, recipients: [] },
      ],
    });
    await syncChecks();
    expect(mockCancel.mock.calls).toEqual([[stray]]);
  });

  it("sets a plan's day with one id, however many tries it takes", async () => {
    mockCreate.mockImplementation(lost);
    const at = new Date(Date.now() + 2 * HOUR);
    await settled(
      startPlan({
        days: [0, 1, 2, 3, 4, 5, 6],
        at: `${String(at.getHours())}:${String(at.getMinutes()).padStart(2, '0')}`,
        grace: 10,
        place: null,
        recipients: [ayse.userId],
      }),
    );
    await settled(planTick());
    const ids = new Set(mockCreate.mock.calls.map(([id]) => id));
    expect(mockCreate.mock.calls.length).toBeGreaterThan(3);
    expect(ids.size).toBe(1);
    // That id is the plan's own: a sync never takes it for a stray.
    const [id] = [...ids];
    mockList.mockResolvedValue({
      checkins: [{ id: id ?? '', openAt: Date.now() + 2 * HOUR, firedAt: null, recipients: [] }],
    });
    mockCreate.mockResolvedValue({ ok: true });
    await settled(syncChecks());
    expect(mockCancel).not.toHaveBeenCalled();
    expect(useOwnChecks.getState().checks.map((each) => each.id)).toEqual([id]);
  });
});

describe('signing out with a check open (QA-44 Düşük 3)', () => {
  it('cancels it on the server first, and says when it could not', async () => {
    mockCreate.mockResolvedValue({ ok: true });
    await settled(startCheck(check()));
    const [id] = useOwnChecks.getState().checks.map((each) => each.id);
    expect(await closeChecksBeforeSignOut()).toBe(true);
    expect(mockCancel).toHaveBeenCalledWith(id);
    mockCancel.mockImplementationOnce(lost);
    expect(await closeChecksBeforeSignOut()).toBe(false);
  });
});

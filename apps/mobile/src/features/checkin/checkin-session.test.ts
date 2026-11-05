import { exportDeviceKeyBundle, randomUuid, sealDirect } from '@bargu/crypto';
import type { CheckinInbox, CheckinList, CheckinReply, ServerEvent } from '@bargu/schemas';

import { circlesKey } from '../circles/circle-cache';
import { verifiedBundle } from '../keys/bundle-cache';
import { circleOf, exchangeKeys, type Person, somebody } from '../location/test-support';
import { queryClient } from '../query-client';
import { announceCheckinOk } from './checkin-events';
import { alertOf, type OwnCheck } from './checkin-model';
import {
  ackAlert,
  checkinLowBattery,
  closeChecksBeforeSignOut,
  extendCheck,
  fetchAlerts,
  imOk,
  ownChecks,
  planTick,
  skipNext,
  startCheck,
  startPlan,
  stopPlan,
  syncChecks,
  useAlerts,
  useOwnChecks,
} from './checkin-session';

// The phone the module acts as (its keys, vault and account), and what the server answers.
let mockPhone: Person;
let mockSignedOut: (() => void) | undefined;
let mockServerEvents: ((events: ServerEvent[]) => void) | undefined;
let mockVaultOpen = true;
const mockCreate = jest.fn<Promise<CheckinReply>, [string, number, unknown]>();
const mockCancel = jest.fn<Promise<CheckinReply>, [string]>();
const mockList = jest.fn<Promise<CheckinList>, []>();
const mockInbox = jest.fn<Promise<CheckinInbox>, []>();
const mockExtend = jest.fn<Promise<CheckinReply>, [string, number, unknown]>();
const mockRefresh = jest.fn<Promise<CheckinReply>, [string, unknown]>();
const mockAck = jest.fn<Promise<void>, [string]>();
const mockSendLine = jest.fn<Promise<'sent' | 'failed'>, [string, unknown]>();
const mockNotice = jest.fn();
jest.mock('./checkin-api', () => ({
  checkinApi: {
    create: (id: string, openAt: number, boxes: unknown) => mockCreate(id, openAt, boxes),
    cancel: (id: string) => mockCancel(id),
    list: () => mockList(),
    inbox: () => mockInbox(),
    extend: (id: string, openAt: number, boxes: unknown) => mockExtend(id, openAt, boxes),
    refresh: (id: string, boxes: unknown) => mockRefresh(id, boxes),
    ack: (id: string) => mockAck(id),
  },
}));
const mockNativeSchedule = jest.fn<Promise<string>, [unknown]>();
const mockNativeCancel = jest.fn<Promise<void>, [string]>();
const mockNativeDismiss = jest.fn<Promise<void>, [string]>();
const mockNativeScheduled = jest.fn<Promise<{ identifier: string }[]>, []>();
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (request: unknown) => mockNativeSchedule(request),
  cancelScheduledNotificationAsync: (id: string) => mockNativeCancel(id),
  dismissNotificationAsync: (id: string) => mockNativeDismiss(id),
  getAllScheduledNotificationsAsync: () => mockNativeScheduled(),
  setNotificationCategoryAsync: () => Promise.resolve(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('./checkin-outbox', () => ({
  loadCheckinOutbox: () =>
    Promise.resolve({
      sendCheckinLine: (userId: string, line: unknown) => mockSendLine(userId, line),
    }),
}));
jest.mock('@/ui/toast', () => ({ toast: { notice: mockNotice } }));
jest.mock('../auth/auth-store', () => ({
  useAuth: { getState: () => ({ userId: mockPhone.userId, device: mockPhone.device }) },
  onSignedOut: (listener: () => void) => {
    mockSignedOut = listener;
    return () => {
      mockSignedOut = undefined;
    };
  },
}));
jest.mock('../live/live-session', () => ({
  keys: () => mockPhone.keys,
  onOnline: jest.fn(),
  onServerEvents: (listener: (events: ServerEvent[]) => void) => {
    mockServerEvents = listener;
    return () => {
      mockServerEvents = undefined;
    };
  },
}));
jest.mock('../storage/vault', () => ({
  isVaultOpen: () => mockVaultOpen,
  vault: () => mockPhone.store,
}));
jest.mock('../location/engine', () => ({ useMyFix: { getState: () => ({ fix: null }) } }));
// The battery's native module is not there on Linux (CI): half full, not charging.
jest.mock('expo-battery', () => ({
  getPowerStateAsync: () => Promise.resolve({ batteryLevel: 0.5, batteryState: 1 }),
  BatteryState: { UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
}));

const HOUR = 3_600_000;
const lost = () => Promise.reject(new Error('timeout'));
let ayse: Person;
let other: Person;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 10, 2, 18, 0) });
  mockSignedOut?.();
  mockCreate.mockReset();
  mockCancel.mockReset().mockResolvedValue({ ok: true });
  mockList.mockReset().mockResolvedValue({ checkins: [] });
  mockInbox.mockReset().mockResolvedValue({ alerts: [] });
  mockExtend.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset().mockResolvedValue({ ok: true });
  mockAck.mockReset().mockResolvedValue();
  mockSendLine.mockReset().mockResolvedValue('sent');
  mockNotice.mockReset();
  mockNativeSchedule.mockReset().mockResolvedValue('due');
  mockNativeCancel.mockReset().mockResolvedValue();
  mockNativeDismiss.mockReset().mockResolvedValue();
  mockNativeScheduled.mockReset().mockResolvedValue([]);
  mockVaultOpen = true;
  mockPhone = somebody();
  ayse = somebody();
  other = somebody();
  const circle = circleOf([mockPhone, ayse, other]);
  exchangeKeys(circle, [mockPhone, ayse, other]);
  queryClient.setQueryData(circlesKey, [circle]);
  ownChecks();
  useOwnChecks.setState({ checks: [], plans: [], pending: [], unsure: [] }, true);
  useAlerts.setState(
    { alerts: [], unreadable: [], resolved: [], arrived: [], revisions: [] },
    true,
  );
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

function storedCheck(over: Partial<OwnCheck> = {}): OwnCheck {
  return {
    id: randomUuid(),
    ...check(),
    seq: 0,
    createdAt: Date.now(),
    extends: 0,
    sentAt: Date.now(),
    state: 'armed',
    ...over,
  };
}

function alertFrom(
  owner: Person,
  seq: number,
  checkinId: string,
  note?: string,
): CheckinInbox['alerts'][number] {
  const own = storedCheck({
    id: checkinId,
    seq,
    recipients: [mockPhone.userId],
    ...(note === undefined ? {} : { note }),
  });
  return {
    checkinId,
    ownerId: owner.userId,
    firedAt: Date.now(),
    box: sealDirect({
      sender: owner.device,
      recipient: verifiedBundle(exportDeviceKeyBundle(mockPhone.device)),
      payload: alertOf(own, null, null, Date.now()),
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

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

  it('awaits a late arrival line after an offline cancellation and reports its failure', async () => {
    const own = storedCheck({ state: 'done' });
    useOwnChecks.setState((state) => ({
      ...state,
      checks: [own],
      pending: [
        {
          checkinId: own.id,
          recipients: own.recipients,
          how: 'arrived',
          late: false,
        },
      ],
    }));
    mockCancel.mockResolvedValueOnce({ refused: 'FIRED' });
    const sendingLine = deferred<'sent' | 'failed'>();
    mockSendLine.mockReturnValueOnce(sendingLine.promise);
    let finished = false;
    const closing = closeChecksBeforeSignOut().then((result) => {
      finished = true;
      return result;
    });
    expect(useOwnChecks.getState().pending).toHaveLength(1);
    await flush();
    expect(mockCancel).toHaveBeenCalledWith(own.id);
    expect(mockSendLine).toHaveBeenCalledWith(ayse.userId, {
      kind: 'checkinOk',
      checkinId: own.id,
      late: true,
    });
    expect(finished).toBe(false);
    sendingLine.resolve('sent');
    await expect(closing).resolves.toBe(true);

    useOwnChecks.setState((state) => ({
      ...state,
      pending: [
        {
          checkinId: own.id,
          recipients: own.recipients,
          how: 'arrived',
          late: true,
        },
      ],
    }));
    mockCancel.mockResolvedValueOnce({ refused: 'FIRED' });
    mockSendLine.mockResolvedValueOnce('failed');
    await expect(closeChecksBeforeSignOut()).resolves.toBe(false);
  });

  it('awaits a normal pending arrival line even when it is not late', async () => {
    const own = storedCheck({ state: 'done' });
    useOwnChecks.setState((state) => ({
      ...state,
      checks: [own],
      pending: [{ checkinId: own.id, recipients: own.recipients, how: 'arrived', late: false }],
    }));
    const sendingLine = deferred<'sent' | 'failed'>();
    mockSendLine.mockReturnValueOnce(sendingLine.promise);
    let finished = false;
    const closing = closeChecksBeforeSignOut().then((result) => {
      finished = true;
      return result;
    });
    await flush();
    expect(mockSendLine).toHaveBeenCalledWith(ayse.userId, {
      kind: 'checkinOk',
      checkinId: own.id,
      late: false,
    });
    expect(finished).toBe(false);
    sendingLine.resolve('sent');
    await expect(closing).resolves.toBe(true);
  });

  it('does not target a completed plan day again during signout', async () => {
    const own = storedCheck({ state: 'done', planId: 'plan-done' });
    useOwnChecks.setState((state) => ({
      ...state,
      checks: [own],
      plans: [
        {
          id: 'plan-done',
          days: [0, 1, 2, 3, 4, 5, 6],
          at: '20:00',
          grace: 10,
          place: null,
          recipients: own.recipients,
          lastDue: own.due,
          skip: [],
          day: { id: own.id, due: own.due },
        },
      ],
    }));
    await expect(closeChecksBeforeSignOut()).resolves.toBe(true);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockSendLine).not.toHaveBeenCalled();
  });
});

describe('account generation isolation (QA-45)', () => {
  it('drops a delayed create answer and never retries it as the next account', async () => {
    const answer = deferred<CheckinReply>();
    const id = randomUuid();
    mockCreate.mockReturnValueOnce(answer.promise);
    const starting = startCheck({ ...check(), id });
    await flush();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    useAlerts.setState((state) => ({
      ...state,
      arrived: [{ ownerId: ayse.userId, checkinId: id, receivedAt: Date.now() }],
    }));

    mockSignedOut?.();
    mockPhone = somebody();
    answer.resolve({ ok: true });
    await expect(starting).resolves.toBe('failed');
    await settled(Promise.resolve());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockSendLine).not.toHaveBeenCalled();
    expect(useOwnChecks.getState()).toEqual({ checks: [], plans: [], pending: [], unsure: [] });
    expect(useAlerts.getState().arrived).toEqual([]);
  });

  it('drops a delayed inbox answer instead of showing the previous account alerts', async () => {
    const answer = deferred<CheckinInbox>();
    const id = randomUuid();
    mockInbox.mockReturnValueOnce(answer.promise);
    const fetching = fetchAlerts();
    await flush();
    mockSignedOut?.();
    mockPhone = somebody();
    answer.resolve({ alerts: [alertFrom(ayse, 1, id, 'A alert')] });
    await expect(fetching).rejects.toThrow('check-in session changed');
    expect(useAlerts.getState()).toEqual({
      alerts: [],
      unreadable: [],
      resolved: [],
      arrived: [],
      revisions: [],
    });
  });

  it('does not turn a delayed sync list into cancels under the next account', async () => {
    const answer = deferred<CheckinList>();
    const stray = randomUuid();
    mockList.mockReturnValueOnce(answer.promise);
    const syncing = syncChecks();
    await flush();
    mockSignedOut?.();
    mockPhone = somebody();
    answer.resolve({
      checkins: [{ id: stray, openAt: Date.now() + HOUR, firedAt: null, recipients: [] }],
    });
    await expect(syncing).rejects.toThrow('check-in session changed');
    expect(mockCancel).not.toHaveBeenCalled();
    expect(useOwnChecks.getState().checks).toEqual([]);
  });

  it('clears both stores when the vault key is not available', () => {
    const own = storedCheck();
    useOwnChecks.setState((state) => ({ ...state, checks: [own] }));
    useAlerts.setState((state) => ({
      ...state,
      arrived: [{ ownerId: ayse.userId, checkinId: own.id, receivedAt: Date.now() }],
    }));
    mockVaultOpen = false;
    expect(ownChecks().checks).toEqual([]);
    expect(useAlerts.getState()).toEqual({
      alerts: [],
      unreadable: [],
      resolved: [],
      arrived: [],
      revisions: [],
    });
  });
});

describe('uncertain create reconciliation (QA-45)', () => {
  it('keeps syncing an empty list, cancels a late create, then stops its timer', async () => {
    mockCreate.mockImplementation(lost);
    expect(await settled(startCheck(check()))).toBe('failed');
    const [waiting] = useOwnChecks.getState().unsure;
    expect(waiting).toBeDefined();
    mockList.mockClear();

    await syncChecks();
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(useOwnChecks.getState().unsure).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(useOwnChecks.getState().unsure).toHaveLength(1);

    mockList.mockResolvedValue({
      checkins: [
        {
          id: waiting?.id ?? '',
          openAt: waiting?.openAt ?? 0,
          firedAt: null,
          recipients: [],
        },
      ],
    });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockCancel).toHaveBeenCalledWith(waiting?.id);
    expect(useOwnChecks.getState().unsure).toEqual([]);
    mockList.mockClear();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe('settling wins over an older armed response (QA-45)', () => {
  it('does not resurrect a done check from a deferred refresh', async () => {
    const own = storedCheck();
    useOwnChecks.setState((state) => ({ ...state, checks: [own] }));
    const answer = deferred<CheckinReply>();
    mockRefresh.mockReturnValueOnce(answer.promise);
    const refreshing = checkinLowBattery();
    await flush();
    expect(mockRefresh).toHaveBeenCalledWith(own.id, expect.anything());
    await imOk(own.id);
    answer.resolve({ ok: true });
    await refreshing;
    expect(useOwnChecks.getState().checks[0]).toMatchObject({ id: own.id, state: 'done', seq: 0 });
  });

  it('does not resurrect a done check from a deferred extend', async () => {
    const own = storedCheck();
    useOwnChecks.setState((state) => ({ ...state, checks: [own] }));
    const answer = deferred<CheckinReply>();
    mockExtend.mockReturnValueOnce(answer.promise);
    const extending = extendCheck(own.id);
    await flush();
    expect(mockExtend).toHaveBeenCalledWith(own.id, expect.any(Number), expect.anything());
    await imOk(own.id);
    answer.resolve({ ok: true });
    await expect(extending).resolves.toBe('NOT_FOUND');
    expect(useOwnChecks.getState().checks[0]).toMatchObject({
      id: own.id,
      state: 'done',
      seq: 0,
      due: own.due,
    });
  });
});

describe('deferred native reminder completion (QA-45)', () => {
  it('cancels a startCheck reminder that finishes after imOk', async () => {
    mockCreate.mockResolvedValue({ ok: true });
    const native = deferred<string>();
    mockNativeSchedule.mockReturnValueOnce(native.promise);
    const starting = startCheck(check());
    await flush();
    const [own] = useOwnChecks.getState().checks;
    expect(own).toBeDefined();
    await imOk(own?.id ?? '');
    mockNativeCancel.mockClear();
    native.resolve('due');
    await starting;
    expect(mockNativeCancel).toHaveBeenCalledWith(`checkin-due:${own?.id ?? ''}`);
    expect(useOwnChecks.getState().checks[0]?.state).toBe('done');
  });

  it('cancels an extendCheck reminder that finishes after settle', async () => {
    mockCreate.mockResolvedValue({ ok: true });
    await settled(startCheck(check()));
    const [own] = useOwnChecks.getState().checks;
    const native = deferred<string>();
    mockNativeSchedule.mockReturnValueOnce(native.promise);
    const extending = extendCheck(own?.id ?? '');
    await flush();
    await imOk(own?.id ?? '');
    mockNativeCancel.mockClear();
    native.resolve('due');
    await extending;
    expect(mockNativeCancel).toHaveBeenCalledWith(`checkin-due:${own?.id ?? ''}`);
    expect(useOwnChecks.getState().checks[0]?.state).toBe('done');
  });

  it('cancels a reminder that finishes after signout cancelAllDue', async () => {
    mockCreate.mockResolvedValue({ ok: true });
    const native = deferred<string>();
    mockNativeSchedule.mockReturnValueOnce(native.promise);
    const starting = startCheck(check());
    await flush();
    const [own] = useOwnChecks.getState().checks;
    mockSignedOut?.();
    mockPhone = somebody();
    await flush();
    mockNativeCancel.mockClear();
    native.resolve('due');
    await expect(starting).resolves.toBe('failed');
    expect(mockNativeCancel).toHaveBeenCalledWith(`checkin-due:${own?.id ?? ''}`);
  });
});

describe('a plan skipped or stopped while create is pending (QA-45)', () => {
  const input = () => {
    const at = new Date(Date.now() + 2 * HOUR);
    return {
      days: [0, 1, 2, 3, 4, 5, 6],
      at: `${String(at.getHours())}:${String(at.getMinutes()).padStart(2, '0')}`,
      grace: 10 as const,
      place: null,
      recipients: [ayse.userId],
    };
  };

  it('cancels the created day without arming it or writing lastDue after skip', async () => {
    const answer = deferred<CheckinReply>();
    mockCreate.mockReturnValueOnce(answer.promise);
    const starting = startPlan(input());
    const plan = useOwnChecks.getState().plans[0];
    await flush();
    const [id] = mockCreate.mock.calls[0] ?? [];
    await skipNext(plan?.id ?? '');
    answer.resolve({ ok: true });
    await starting;
    expect(mockCancel).toHaveBeenCalledWith(id);
    expect(useOwnChecks.getState().checks).toEqual([]);
    expect(useOwnChecks.getState().plans[0]).toMatchObject({ lastDue: null });
  });

  it('cancels the created day without arming it after stopPlan', async () => {
    const answer = deferred<CheckinReply>();
    mockCreate.mockReturnValueOnce(answer.promise);
    const starting = startPlan(input());
    const plan = useOwnChecks.getState().plans[0];
    await flush();
    const [id] = mockCreate.mock.calls[0] ?? [];
    stopPlan(plan?.id ?? '');
    answer.resolve({ ok: true });
    await starting;
    expect(mockCancel).toHaveBeenCalledWith(id);
    expect(useOwnChecks.getState().checks).toEqual([]);
    expect(useOwnChecks.getState().plans).toEqual([]);
  });

  it('queues a rejected post-create cancel for signout and sends late after sync FIRED', async () => {
    const answer = deferred<CheckinReply>();
    mockCreate.mockReturnValueOnce(answer.promise);
    const starting = startPlan(input());
    const plan = useOwnChecks.getState().plans[0];
    await flush();
    const [id] = mockCreate.mock.calls[0] ?? [];
    await skipNext(plan?.id ?? '');
    mockCancel.mockImplementationOnce(lost);
    answer.resolve({ ok: true });
    await starting;
    expect(useOwnChecks.getState().checks).toEqual([]);
    expect(useOwnChecks.getState().pending).toEqual([
      { checkinId: id, recipients: [ayse.userId], how: 'skipped', late: false },
    ]);

    mockSendLine.mockClear();
    await expect(closeChecksBeforeSignOut()).resolves.toBe(true);
    expect(mockCancel).toHaveBeenCalledWith(id);
    expect(mockSendLine).not.toHaveBeenCalled();
    mockCancel.mockResolvedValueOnce({ refused: 'FIRED' });
    await syncChecks();
    await flush();
    expect(mockSendLine).toHaveBeenCalledWith(ayse.userId, {
      kind: 'checkinOk',
      checkinId: id,
      late: true,
    });
  });
});

describe('offline cancellation line semantics (QA-45)', () => {
  it('keeps an unfired skipped cancellation silent, including its legacy-safe replay', async () => {
    const own = storedCheck({ planId: 'plan-1' });
    useOwnChecks.setState((state) => ({
      ...state,
      checks: [own],
      plans: [
        {
          id: 'plan-1',
          days: [0, 1, 2, 3, 4, 5, 6],
          at: '20:00',
          grace: 10,
          place: null,
          recipients: own.recipients,
          lastDue: null,
          skip: [],
          day: { id: own.id, due: own.due },
        },
      ],
    }));
    mockCancel.mockImplementationOnce(lost);
    await skipNext('plan-1');
    expect(useOwnChecks.getState().pending[0]).toMatchObject({ how: 'skipped', late: false });
    mockSendLine.mockClear();
    await syncChecks();
    await flush();
    expect(
      mockSendLine.mock.calls.filter(([, line]) => (line as { kind: string }).kind === 'checkinOk'),
    ).toEqual([]);
  });

  it('sends late when an offline skipped cancellation turns out to have fired', async () => {
    const own = storedCheck({ state: 'done' });
    useOwnChecks.setState((state) => ({
      ...state,
      checks: [own],
      pending: [{ checkinId: own.id, recipients: own.recipients, how: 'skipped', late: false }],
    }));
    mockCancel.mockResolvedValueOnce({ refused: 'FIRED' });
    await syncChecks();
    await flush();
    expect(mockSendLine).toHaveBeenCalledWith(ayse.userId, {
      kind: 'checkinOk',
      checkinId: own.id,
      late: true,
    });
  });

  it('treats a legacy pending entry as a normal arrival, never as silent skipped', async () => {
    const id = randomUuid();
    mockSignedOut?.();
    mockPhone.store.set(
      'checkin:own:v1',
      JSON.stringify({
        checks: [],
        plans: [],
        pending: [{ checkinId: id, recipients: [ayse.userId] }],
        unsure: [],
      }),
    );
    await syncChecks();
    await flush();
    expect(mockSendLine).toHaveBeenCalledWith(ayse.userId, {
      kind: 'checkinOk',
      checkinId: id,
      late: false,
    });
  });
});

describe('recipient replay and arrival memory (QA-45)', () => {
  it('rejects lower and conflicting equal seq, accepts newer seq, and scopes owners', async () => {
    const id = randomUuid();
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 2, id, 'seq 2')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts[0]).toMatchObject({ seq: 2, note: 'seq 2' });

    mockInbox.mockResolvedValue({
      alerts: [alertFrom(ayse, 1, id, 'old'), alertFrom(other, 1, id, 'other owner')],
    });
    await fetchAlerts();
    expect(useAlerts.getState().alerts).toHaveLength(2);
    expect(
      useAlerts.getState().alerts.find((alert) => alert.ownerId === ayse.userId),
    ).toMatchObject({ seq: 2, note: 'seq 2' });
    expect(
      useAlerts.getState().alerts.find((alert) => alert.ownerId === other.userId),
    ).toMatchObject({ seq: 1, note: 'other owner' });

    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 3, id, 'seq 3')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts[0]).toMatchObject({ seq: 3, note: 'seq 3' });
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 3, id, 'conflict')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts[0]).toMatchObject({ seq: 3, note: 'seq 3' });
  });

  it('keeps replay protection after an empty page, a full page, and a vault reload', async () => {
    const id = randomUuid();
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 3, id, 'seq 3')] });
    await fetchAlerts();
    expect(useAlerts.getState().revisions[0]).toMatchObject({
      ownerId: ayse.userId,
      checkinId: id,
      seq: 3,
    });

    mockInbox.mockResolvedValue({ alerts: [] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts).toEqual([]);
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 2, id, 'stale')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts).toEqual([]);
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 4, id, 'seq 4')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts[0]).toMatchObject({ seq: 4, note: 'seq 4' });

    mockInbox.mockResolvedValue({
      alerts: Array.from({ length: 50 }, () => alertFrom(ayse, 1, randomUuid())),
    });
    await fetchAlerts();
    expect(useAlerts.getState().alerts.some((alert) => alert.checkinId === id)).toBe(false);
    expect(useAlerts.getState().revisions.find((revision) => revision.checkinId === id)?.seq).toBe(
      4,
    );
    mockSignedOut?.();
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 3, id, 'after restart')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts).toEqual([]);

    mockInbox.mockResolvedValue({ alerts: [alertFrom(other, 1, id, 'other owner')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts[0]).toMatchObject({
      ownerId: other.userId,
      seq: 1,
      note: 'other owner',
    });
  });

  it('accepts a lower seq only after the earlier signed payload validity expires', async () => {
    const id = randomUuid();
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 3, id, 'expires')] });
    await fetchAlerts();
    const validUntil = useAlerts.getState().revisions[0]?.validUntil ?? 0;
    expect(validUntil).toBeGreaterThan(Date.now());
    jest.setSystemTime(validUntil + 1);
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 2, id, 'new validity')] });
    await fetchAlerts();
    expect(useAlerts.getState().alerts[0]).toMatchObject({ seq: 2, note: 'new validity' });
    expect(useAlerts.getState().revisions[0]?.validUntil).toBeGreaterThan(Date.now());
  });

  it('uses arrivedBefore for the same owner only and suppresses its fired toast', async () => {
    const id = randomUuid();
    announceCheckinOk({ ownerId: ayse.userId, checkinId: id });
    mockInbox.mockResolvedValue({
      alerts: [alertFrom(ayse, 1, id), alertFrom(other, 1, id)],
    });
    mockServerEvents?.([{ type: 'checkin.fired', checkinId: id, ownerId: ayse.userId }]);
    await flush();
    expect(mockNotice).not.toHaveBeenCalled();
    expect(useAlerts.getState().resolved).toEqual([
      { checkinId: id, ownerId: ayse.userId, firedAt: Date.now() },
    ]);
    expect(useAlerts.getState().alerts).toHaveLength(1);
    expect(useAlerts.getState().alerts[0]?.ownerId).toBe(other.userId);
  });

  it('persists arrived memory across restart and prunes it after 48 hours', async () => {
    const id = randomUuid();
    announceCheckinOk({ ownerId: ayse.userId, checkinId: id });
    mockSignedOut?.();
    mockInbox.mockResolvedValue({ alerts: [alertFrom(ayse, 1, id)] });
    await fetchAlerts();
    expect(useAlerts.getState().resolved).toHaveLength(1);
    expect(useAlerts.getState().alerts).toEqual([]);

    jest.setSystemTime(Date.now() + 48 * HOUR + 1);
    mockInbox.mockResolvedValue({ alerts: [] });
    await fetchAlerts();
    expect(useAlerts.getState().arrived).toEqual([]);
    expect(useAlerts.getState().resolved).toEqual([]);
  });
});

describe('acking a full alert page (QA-45)', () => {
  it('fetches the remaining ten of sixty alerts immediately after ack', async () => {
    const all = Array.from({ length: 60 }, () => alertFrom(ayse, 1, randomUuid()));
    mockInbox
      .mockResolvedValueOnce({ alerts: all.slice(0, 50) })
      .mockResolvedValueOnce({ alerts: all.slice(50) });
    await fetchAlerts();
    expect(useAlerts.getState().alerts).toHaveLength(50);
    const first = all[0]?.checkinId ?? '';
    await ackAlert(first);
    expect(mockAck).toHaveBeenCalledWith(first);
    expect(mockInbox).toHaveBeenCalledTimes(2);
    expect(useAlerts.getState().alerts.map((alert) => alert.checkinId)).toEqual(
      all.slice(50).map((alert) => alert.checkinId),
    );
    expect(useAlerts.getState().alerts).toHaveLength(10);
  });

  it('does not fetch again after acking a page that was not full', async () => {
    const only = alertFrom(ayse, 1, randomUuid());
    mockInbox.mockResolvedValueOnce({ alerts: [only] });
    await fetchAlerts();
    await ackAlert(only.checkinId);
    expect(mockInbox).toHaveBeenCalledTimes(1);
    expect(useAlerts.getState().alerts).toEqual([]);
  });
});

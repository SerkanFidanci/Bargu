import { SEND_RULES } from './send';
import { BATCH_WINDOW_MS, bestOfBatch, startTracking, stopTracking, TRACKING } from './tracker';

// The restart notice has its own tests (restart-notice.test.ts).
jest.mock('./restart-notice', () => ({
  armRestartNotice: jest.fn(),
  disarmRestartNotice: jest.fn(),
}));

// The location service: what it is asked to do is recorded.
const mockStart = jest.fn<Promise<void>, [string, Record<string, unknown>]>(() =>
  Promise.resolve(),
);
jest.mock('expo-location', () => ({
  Accuracy: { High: 5, Balanced: 3, BestForNavigation: 6 },
  ActivityType: { Other: 1 },
  hasStartedLocationUpdatesAsync: () => Promise.resolve(false),
  startLocationUpdatesAsync: (task: string, options: Record<string, unknown>) =>
    mockStart(task, options),
  stopLocationUpdatesAsync: () => Promise.resolve(),
}));

const restart = { title: 'Paylaşım durdu', body: 'Telefon yeniden başladı.' };
const asked = () => mockStart.mock.calls.at(-1)?.[1];

beforeEach(async () => {
  jest.clearAllMocks();
  await stopTracking();
});

describe('the location service and the battery (docs/ADR/0036)', () => {
  it('rests the GPS between positions: one every 30 s, never every 5 s', async () => {
    await startTracking({ gps: true, title: 'Konum', body: 'Paylaşılıyor', restart });
    expect(asked()).toMatchObject({ accuracy: 5, timeInterval: 30_000, distanceInterval: 0 });
  });

  it('wakes a closed app with its positions once a minute, so it sends at most that often', async () => {
    await startTracking({ gps: true, title: 'Konum', body: 'Paylaşılıyor', restart });
    expect(asked()).toMatchObject({ deferredUpdatesInterval: 60_000 });
  });

  it('asks Wi-Fi and cell towers once a minute when only coarse cells are shared', async () => {
    await startTracking({ gps: false, title: 'Konum', body: 'Paylaşılıyor', restart });
    expect(asked()).toMatchObject({ accuracy: 3, timeInterval: 60_000 });
  });

  it('keeps going with the app swiped away: friends keep seeing it (the owner)', async () => {
    await startTracking({ gps: true, title: 'Konum', body: 'Paylaşılıyor', restart });
    expect(asked()).toMatchObject({ foregroundService: { killServiceOnDestroy: false } });
  });
});

describe('a batch gathered in the background (docs/ADR/0036, QA-39)', () => {
  const at = (timestamp: number, accuracy: number | null) => ({ timestamp, coords: { accuracy } });
  const MIN = 60_000;

  it('gives the sharpest of the last minute', () => {
    const newest = at(5 * MIN, 60);
    const sharp = at(5 * MIN - 50_000, 8);
    const sharperButOld = at(5 * MIN - MIN - 1, 3);
    expect(bestOfBatch([sharperButOld, sharp, newest])).toBe(sharp);
  });

  it('takes the newest when the accuracies are close', () => {
    const newest = at(5 * MIN, 12);
    const sharper = at(5 * MIN - 30_000, 5);
    // 12 m is within 10 m of 5 m: as good, and newer.
    expect(bestOfBatch([sharper, newest])).toBe(newest);
    const far = at(5 * MIN, 30);
    expect(bestOfBatch([sharper, far])).toBe(sharper);
  });

  it('takes the newest when none says its accuracy, and nothing from an empty batch', () => {
    const newest = at(5 * MIN, null);
    expect(bestOfBatch([at(5 * MIN - 1_000, null), newest])).toBe(newest);
    expect(bestOfBatch([])).toBeNull();
  });

  it('keeps the numbers of the ADR', () => {
    expect(TRACKING).toMatchObject({
      gpsIntervalMs: 30_000,
      coarseIntervalMs: 60_000,
      liveIntervalMs: 1_000,
      backgroundBatchMs: 60_000,
    });
    expect(BATCH_WINDOW_MS).toBe(60_000);
  });

  it('sends live at the pace the service reports: one second, never a second slower (ADR 0028)', () => {
    // The open map and a friend looking get a position every second; the send rule lets exactly
    // each of them through (a little under the second, so clock jitter drops none).
    expect(TRACKING.liveIntervalMs).toBe(1_000);
    expect(SEND_RULES.liveIntervalMs).toBe(900);
    expect(SEND_RULES.liveIntervalMs).toBeLessThan(TRACKING.liveIntervalMs);
    // Closed and moving: each of the service's minute batches goes, none skipped for coming a
    // moment early (ADR 0036, QA-40).
    expect(SEND_RULES.backgroundIntervalMs).toBeLessThan(TRACKING.backgroundBatchMs);
    expect(SEND_RULES.backgroundIntervalMs).toBeGreaterThanOrEqual(
      TRACKING.backgroundBatchMs * 0.8,
    );
  });
});

import { bestOfBatch, startTracking, stopTracking, TRACKING } from './tracker';

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

  it('gives the sharpest of the last GPS interval, the newest of equals', () => {
    const newest = at(100_000, 40);
    const sharp = at(100_000 - TRACKING.gpsIntervalMs, 8);
    const sharperButOld = at(100_000 - TRACKING.gpsIntervalMs - 1, 3);
    expect(bestOfBatch([sharperButOld, sharp, newest])).toBe(sharp);
    const twin = at(95_000, 8);
    expect(bestOfBatch([sharp, twin, newest])).toBe(twin);
    // No accuracy given: never preferred over one that has it.
    expect(bestOfBatch([at(99_000, null), newest])).toBe(newest);
    expect(bestOfBatch([])).toBeNull();
    expect(TRACKING).toMatchObject({
      gpsIntervalMs: 30_000,
      coarseIntervalMs: 60_000,
      backgroundBatchMs: 60_000,
    });
  });
});

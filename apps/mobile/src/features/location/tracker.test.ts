import { startTracking, stopTracking } from './tracker';

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

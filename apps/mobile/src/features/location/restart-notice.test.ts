import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRIVACY_CHANNEL } from '../notifications/channels';
import { startTracking, stopTracking } from './tracker';

// The native side, as a pair of spies. Where there is none (iOS, Jest by default) the module is null.
const mockArm = jest.fn<undefined, [string, string]>();
const mockDisarm = jest.fn<undefined, []>();
jest.mock('../../../modules/bargu-restart-notice', () => ({
  __esModule: true,
  default: {
    arm: (...args: [string, string]) => {
      mockArm(...args);
    },
    disarm: () => {
      mockDisarm();
    },
  },
}));

// The location service: whether it runs is a flag a test can read, and each call is recorded.
let mockRunning = false;
const mockStart = jest.fn<Promise<void>, []>();
const mockStop = jest.fn<Promise<void>, []>();
jest.mock('expo-location', () => ({
  Accuracy: { High: 5, Balanced: 3 },
  ActivityType: { Other: 1 },
  hasStartedLocationUpdatesAsync: () => Promise.resolve(mockRunning),
  startLocationUpdatesAsync: () => mockStart(),
  stopLocationUpdatesAsync: () => mockStop(),
}));

const TR = { title: 'Paylaşım durdu', body: 'Telefon yeniden başladı ya da Bargu güncellendi.' };
const EN = { title: 'Sharing stopped', body: 'The phone restarted or Bargu updated.' };
const options = (restart: { title: string; body: string }, gps = true) => ({
  gps,
  title: 'Konumun paylaşılıyor',
  body: 'Çemberlerin seni haritada görüyor.',
  restart,
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockRunning = false;
  mockStart.mockImplementation(() => {
    mockRunning = true;
    return Promise.resolve();
  });
  mockStop.mockImplementation(() => {
    mockRunning = false;
    return Promise.resolve();
  });
  // Forget what an earlier test told the native side (tracker.ts keeps it per process).
  await stopTracking();
  jest.clearAllMocks();
});

describe('the restart notice follows the location service (docs/ADR/0028 addendum)', () => {
  it('is set when the service starts on purpose, with the texts it was given', async () => {
    await startTracking(options(TR));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockArm).toHaveBeenCalledTimes(1);
    // Exactly the two texts: nothing else of the phone or the user goes over.
    expect(mockArm).toHaveBeenCalledWith(TR.title, TR.body);
    expect(mockArm.mock.calls[0]).toHaveLength(2);
  });

  it('is told again only when the language changed, not on every retune', async () => {
    await startTracking(options(TR));
    await startTracking(options(TR));
    expect(mockArm).toHaveBeenCalledTimes(1);
    await startTracking(options(EN));
    expect(mockArm).toHaveBeenCalledTimes(2);
    expect(mockArm).toHaveBeenLastCalledWith(EN.title, EN.body);
    // GPS on or off retunes the service; the notice stays as it was told.
    await startTracking(options(EN, false));
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockArm).toHaveBeenCalledTimes(2);
  });

  it('is cleared when the service is stopped on purpose (ghost, stop all, nothing shared, sign-out)', async () => {
    await startTracking(options(TR));
    await stopTracking();
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockDisarm).toHaveBeenCalledTimes(1);
    // Stopped again with nothing running (the effect asks on every change): nothing more to tell.
    await stopTracking();
    expect(mockDisarm).toHaveBeenCalledTimes(1);
    // Sharing comes back: set again.
    await startTracking(options(TR));
    expect(mockArm).toHaveBeenCalledTimes(2);
  });

  it('is cleared even when stopping the service itself fails', async () => {
    await startTracking(options(TR));
    mockStop.mockRejectedValueOnce(new Error('task manager'));
    await expect(stopTracking()).rejects.toThrow('task manager');
    expect(mockDisarm).toHaveBeenCalledTimes(1);
  });

  it('does not stop sharing when the native side fails', async () => {
    mockArm.mockImplementationOnce(() => {
      throw new Error('prefs');
    });
    await startTracking(options(TR));
    expect(mockStart).toHaveBeenCalledTimes(1);
    // Not remembered as told: the next start tries again.
    await startTracking(options(TR));
    expect(mockArm).toHaveBeenCalledTimes(2);
  });
});

describe('the native side', () => {
  const native = join(
    __dirname,
    '../../../modules/bargu-restart-notice/android/src/main/java/app/bargu/restartnotice',
  );

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this module's own Kotlin source, a fixed path
  const source = readFileSync(join(native, 'RestartNotice.kt'), 'utf8');

  it('posts into the channel the app already makes for its reminders', () => {
    expect(source).toContain(`CHANNEL_ID = "${PRIVACY_CHANNEL}"`);
  });

  it('keeps only a flag and the two texts, and holds no text of its own', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    const stored = [...code.matchAll(/\.put(\w+)\(/g)].map((match) => match[1]);
    expect(stored.sort()).toEqual(['Boolean', 'String', 'String']);
    // The texts come from JavaScript: no Turkish or English sentence in the Kotlin.
    const strings = [...code.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(strings.length).toBeGreaterThan(0);
    expect(strings.filter((text) => /\s/.test(text))).toEqual([]);
  });
});

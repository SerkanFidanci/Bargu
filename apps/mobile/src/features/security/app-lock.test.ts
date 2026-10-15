import * as LocalAuthentication from 'expo-local-authentication';

import { memoryStore } from '../location/test-support';
import {
  LOCK_AFTER_MS,
  loadAppLock,
  resetAppLock,
  restoreAppLock,
  setAppLock,
  shouldLock,
  unlockApp,
  useAppLock,
} from './app-lock';

jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(3)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
}));

const mocked = jest.mocked(LocalAuthentication);
const text = { prompt: 'Doğrula', cancel: 'Vazgeç' };

beforeEach(() => {
  resetAppLock();
  mocked.getEnrolledLevelAsync.mockResolvedValue(
    LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG,
  );
  mocked.authenticateAsync.mockResolvedValue({ success: true });
});

describe('the app lock (Faz 9)', () => {
  it('locks after more than a minute away, only when on', () => {
    expect(shouldLock(true, LOCK_AFTER_MS)).toBe(false);
    expect(shouldLock(true, LOCK_AFTER_MS + 1)).toBe(true);
    expect(shouldLock(false, 10 * LOCK_AFTER_MS)).toBe(false);
  });

  it('turns on and off only once the phone confirms its owner, and starts locked', async () => {
    const store = memoryStore();
    mocked.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    expect(await setAppLock(store, true, text)).toBe('cancelled');
    expect(loadAppLock(store)).toBe(false);

    expect(await setAppLock(store, true, text)).toBe('done');
    expect(loadAppLock(store)).toBe(true);
    restoreAppLock(store);
    expect(useAppLock.getState()).toEqual({ enabled: true, locked: true });

    mocked.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    expect(await unlockApp(text)).toBe(false);
    expect(useAppLock.getState().locked).toBe(true);
    expect(await unlockApp(text)).toBe(true);
    expect(useAppLock.getState().locked).toBe(false);

    expect(await setAppLock(store, false, text)).toBe('done');
    restoreAppLock(store);
    expect(useAppLock.getState()).toEqual({ enabled: false, locked: false });
  });

  it('is not offered on a phone with no screen lock at all', async () => {
    mocked.authenticateAsync.mockClear();
    mocked.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    expect(await setAppLock(memoryStore(), true, text)).toBe('unavailable');
    expect(mocked.authenticateAsync).not.toHaveBeenCalled();
  });
});

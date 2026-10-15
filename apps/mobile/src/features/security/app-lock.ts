import * as LocalAuthentication from 'expo-local-authentication';
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyValueStore } from '../storage/vault';

/**
 * The optional app lock (BARGU_PLAN Faz 9, docs/ADR/0021): off by default; on, the app asks for
 * Face ID, a fingerprint or the phone's passcode when it starts and after a minute away. It
 * covers the screen only: sharing goes on behind it, as the user chose.
 */
export const LOCK_AFTER_MS = 60_000;

const KEY = 'security:app-lock:v1';
const lockSchema = z.object({ enabled: z.boolean() }).strict();

export const useAppLock = create<{ enabled: boolean; locked: boolean }>(() => ({
  enabled: false,
  locked: false,
}));

export function loadAppLock(store: KeyValueStore): boolean {
  const raw = store.get(KEY);
  if (raw === undefined) return false;
  const parsed = lockSchema.safeParse(JSON.parse(raw));
  return parsed.success && parsed.data.enabled;
}

/** The app starts (vault just opened): locked at once when the lock is on. */
export function restoreAppLock(store: KeyValueStore): void {
  const enabled = loadAppLock(store);
  useAppLock.setState({ enabled, locked: enabled }, true);
}

/** Signed out: no lock (the next account chooses its own). */
export function resetAppLock(): void {
  useAppLock.setState({ enabled: false, locked: false }, true);
}

/** Back from the background: locked when the lock is on and it was away longer than a minute. */
export function shouldLock(enabled: boolean, awayMs: number): boolean {
  return enabled && awayMs > LOCK_AFTER_MS;
}

/** Whether this phone can lock the app: some screen lock (biometric or passcode) is set up. */
export async function canLockApp(): Promise<boolean> {
  return (
    (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE
  );
}

/** Asks the phone (Face ID, fingerprint or passcode); true when it says yes. */
export async function confirmOwner(text: { prompt: string; cancel: string }): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: text.prompt,
    cancelLabel: text.cancel,
    disableDeviceFallback: false,
  });
  return result.success;
}

/** Unlocks the app once the phone confirms its owner. */
export async function unlockApp(text: { prompt: string; cancel: string }): Promise<boolean> {
  const ok = await confirmOwner(text);
  if (ok) useAppLock.setState({ locked: false });
  return ok;
}

/**
 * Turns the lock on or off, only once the phone confirms its owner (someone holding the unlocked
 * phone cannot quietly turn it off, nor turn on a lock they could not open).
 */
export async function setAppLock(
  store: KeyValueStore,
  enabled: boolean,
  text: { prompt: string; cancel: string },
): Promise<'done' | 'unavailable' | 'cancelled'> {
  if (enabled && !(await canLockApp())) return 'unavailable';
  if (!(await confirmOwner(text))) return 'cancelled';
  store.set(KEY, JSON.stringify({ enabled }));
  useAppLock.setState({ enabled, locked: false });
  return 'done';
}

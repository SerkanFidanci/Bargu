import { exportDeviceKeyBundle, toBase64url, type DeviceKeys } from '@bargu/crypto';
import {
  type OtpChallenge,
  otpChallengeSchema,
  PLATFORMS,
  type Session,
  sessionSchema,
} from '@bargu/schemas';
import i18next from 'i18next';
import { Platform } from 'react-native';
import { Passkey, type PasskeyGetRequest } from 'react-native-passkey';
import { z } from 'zod';
import { create } from 'zustand';

import { env } from '@/config/env';
import { resolveLanguage } from '@/i18n';

import { createApiClient } from './api-client';
import { createDeviceKeys, deleteDeviceKeys, loadDeviceKeys } from './device-key-store';
import { createSecureSessionStore } from './session-store';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  device: DeviceKeys | null;
  userId: string | null;
}

export const useAuth = create<AuthState>(() => ({
  status: 'loading',
  device: null,
  userId: null,
}));

const sessions = createSecureSessionStore();

/** WebAuthn options from the server, passed to the platform authenticator as they are. */
export const passkeyOptionsSchema = z.object({
  challengeId: z.uuid(),
  options: z.looseObject({ challenge: z.string() }),
});

/** The one API client of the app: signs with this device's key, refreshes the session itself. */
export const api = createApiClient({
  baseUrl: env.apiUrl,
  device: () => useAuth.getState().device,
  session: sessions,
});

/** Listeners run when the session ends (sign-out, device replaced elsewhere, refresh refused). */
const signedOutListeners = new Set<() => void>();
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

sessions.subscribe((session) => {
  if (session !== null || useAuth.getState().status !== 'signedIn') return;
  // The server ended the session (or we did). The device identity is spent either way: a revoked
  // device id never comes back, so the next sign-in starts with fresh keys (docs/ADR/0005).
  void endLocally();
});

async function endLocally(): Promise<void> {
  useAuth.setState({ status: 'signedOut', device: null, userId: null });
  await deleteDeviceKeys();
  for (const listener of signedOutListeners) listener();
}

function platform(): (typeof PLATFORMS)[number] {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/** Reads keys and session from the secure store at start-up. */
export async function bootstrapAuth(): Promise<void> {
  const [device, session] = await Promise.all([loadDeviceKeys(), sessions.load()]);
  if (device === null || session?.deviceId !== device.deviceId) {
    // Half a login (keys without a session, or a session for other keys) is no login.
    if (session !== null) await sessions.set(null);
    useAuth.setState({ status: 'signedOut', device, userId: null });
    return;
  }
  useAuth.setState({ status: 'signedIn', device, userId: session.userId });
}

/** This phone's identity for the next sign-in: the stored one, or fresh keys (persisted first). */
async function signInDevice(): Promise<DeviceKeys> {
  const existing = useAuth.getState().device;
  if (existing !== null) return existing;
  const device = await createDeviceKeys();
  useAuth.setState({ device });
  return device;
}

/** Stores the session the server issued at sign-in; the root layout then moves on. */
async function startSession(response: unknown): Promise<Session> {
  const session = sessionSchema.parse(response);
  await sessions.set(session);
  useAuth.setState({ status: 'signedIn', userId: session.userId });
  return session;
}

/**
 * Passkey sign-in: the platform authenticator signs the server's challenge, this phone registers
 * as the account's device in the same step (signed with its identity key, like the code login).
 * Throws the authenticator's error when the user cancels or has no passkey here.
 */
export async function signInWithPasskey(): Promise<Session> {
  const device = await signInDevice();
  const { challengeId, options } = passkeyOptionsSchema.parse(
    await api.public('/v1/auth/passkey/options', { method: 'POST' }),
  );
  const assertion = await Passkey.get(options as unknown as PasskeyGetRequest);
  const response = await api.public('/v1/auth/passkey/verify', {
    method: 'POST',
    body: {
      challengeId,
      response: assertion,
      device: { platform: platform(), bundle: exportDeviceKeyBundle(device) },
    },
  });
  return startSession(response);
}

/** Step 1: ask for a login code, bound to this phone's identity key. */
export async function requestCode(email: string): Promise<OtpChallenge> {
  const device = await signInDevice();
  const response = await api.public('/v1/auth/otp/request', {
    method: 'POST',
    body: {
      email,
      locale: resolveLanguage(i18next.language),
      identityKey: toBase64url(device.identity.publicKey),
    },
  });
  return otpChallengeSchema.parse(response);
}

/** Step 2: redeem the code; registers this phone as the account's one active device. */
export async function verifyCode(challengeId: string, code: string): Promise<Session> {
  const device = useAuth.getState().device;
  if (device === null) throw new Error('verifyCode before requestCode');
  const response = await api.public('/v1/auth/otp/verify', {
    method: 'POST',
    body: {
      challengeId,
      code,
      device: { platform: platform(), bundle: exportDeviceKeyBundle(device) },
    },
  });
  return startSession(response);
}

/** Signs out here and on the server; local keys are destroyed even when the server is unreachable. */
export async function signOut(): Promise<void> {
  try {
    await api.authed('/v1/auth/logout', { method: 'POST' });
  } catch {
    // Offline or already ended: the refresh token is useless without the deleted device key.
  }
  await sessions.set(null);
  if (useAuth.getState().status !== 'signedOut') await endLocally();
}

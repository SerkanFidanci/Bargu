import {
  type AccountExport,
  accountExportSchema,
  type FindableState,
  findableStateSchema,
  HISTORY_CONSENT_VERSION,
  PRIVACY_NOTICE_VERSION,
  type PrivacyState,
  privacyStateSchema,
} from '@bargu/schemas';
import { create } from 'zustand';

import { api } from '../auth/auth-store';

/** The account's KVKK records (docs/ADR/0022), read when needed and kept here. */
export const privacyKey = ['privacy'] as const;

export async function fetchPrivacy(): Promise<PrivacyState> {
  return privacyStateSchema.parse(await api.authed('/v1/me/privacy'));
}

/** "Okudum, anladım" for the current notice. */
export async function readNotice(): Promise<PrivacyState> {
  return privacyStateSchema.parse(
    await api.authed('/v1/me/privacy/notice', {
      method: 'PUT',
      body: { version: PRIVACY_NOTICE_VERSION },
      idempotent: true,
    }),
  );
}

/** Gives explicit consent to location history (for the text shown), or withdraws it. */
export async function setHistoryConsent(given: boolean): Promise<PrivacyState> {
  return privacyStateSchema.parse(
    await api.authed('/v1/me/privacy/history', {
      method: 'PUT',
      body: { given, version: HISTORY_CONSENT_VERSION },
      idempotent: true,
    }),
  );
}

/** "Kullanıcı adımla bulunabilirim" (docs/ADR/0023): always off for 15-17. */
export const findableKey = ['findable'] as const;

export async function fetchFindable(): Promise<FindableState> {
  return findableStateSchema.parse(await api.authed('/v1/me/findable'));
}

export async function setFindable(findable: boolean): Promise<FindableState> {
  return findableStateSchema.parse(
    await api.authed('/v1/me/findable', {
      method: 'PUT',
      body: { findable },
      idempotent: true,
    }),
  );
}

export async function fetchAccountExport(): Promise<AccountExport> {
  return accountExportSchema.parse(await api.authed('/v1/me/export'));
}

/** Deletes the account for good (the server closes this phone too). */
export async function deleteAccount(): Promise<void> {
  await api.authed('/v1/me/delete', { method: 'POST', body: { confirm: true } });
}

/**
 * The notice read before signing in (the first screens have no account yet): sent once signed in.
 */
export const useNoticeRead = create<{ version: number | null }>(() => ({ version: null }));

/** Whether the account still has to read the current notice. */
export const needsNotice = (state: PrivacyState) =>
  state.notice === null || state.notice.version < PRIVACY_NOTICE_VERSION;

/** Whether location history may go to the server (explicit consent for the current text). */
export const hasHistoryConsent = (state: PrivacyState) =>
  state.history !== null && state.history.version >= HISTORY_CONSENT_VERSION;

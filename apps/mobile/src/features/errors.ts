import type { TFunction } from 'i18next';

import { ApiError } from './auth/api-client';

/** A user-facing sentence for any failure; specific screens handle their own codes first. */
export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RATE_LIMITED':
        return t('errors.rateLimited');
      case 'REFRESH_INVALID':
      case 'DEVICE_REVOKED':
      case 'UNAUTHENTICATED':
        return t('errors.sessionEnded');
      default:
        return t('errors.unknown');
    }
  }
  // fetch rejects with a TypeError when there is no network at all.
  if (error instanceof TypeError) return t('errors.network');
  return t('errors.unknown');
}

export function isApiError(error: unknown, ...codes: string[]): error is ApiError {
  return error instanceof ApiError && (codes.length === 0 || codes.includes(error.code));
}

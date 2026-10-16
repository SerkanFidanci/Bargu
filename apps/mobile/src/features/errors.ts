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
      // docs/ADR/0023
      case 'AGE_REQUIRED':
        return t('errors.ageRequired');
      case 'AGE_RESTRICTED':
        return t('age.noHistory');
      case 'AGE_REVIEW_REQUIRED':
        return t('age.toAdultHint');
      case 'FRIEND_INVITE_ONLY':
        return t('errors.friendInviteOnly');
      // docs/ADR/0023 §5
      case 'GUARDIAN_APPROVAL':
        return t('errors.guardianApproval');
      // docs/ADR/0024 §5
      case 'GUARDIAN_LINK_REQUIRED':
        return t('errors.guardianLinkRequired');
      case 'APPROVAL_PENDING':
        return t('errors.approvalPending');
      case 'REQUEST_FAILED':
        return t('guardians.tools.requestFailed');
      // docs/ADR/0024
      case 'CIRCLE_PAUSED':
        return t('errors.circlePaused');
      case 'ALREADY_SUBSCRIBED':
        return t('errors.alreadySubscribed');
      // QA 19 P4
      case 'UPGRADE_REQUIRED':
        return t('errors.upgradeRequired');
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

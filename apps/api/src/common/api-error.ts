import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/** Stable, machine-readable error codes; the app maps them to localised messages. */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'SIGNATURE_REQUIRED'
  | 'SIGNATURE_INVALID'
  /** The request time is outside the accepted window; see the Date response header. */
  | 'CLOCK_SKEW'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'DEVICE_KEYS_INVALID'
  | 'DEVICE_CONFLICT'
  | 'DEVICE_REVOKED'
  | 'ATTESTATION_REQUIRED'
  | 'ATTESTATION_INVALID'
  | 'PASSKEY_INVALID'
  | 'REFRESH_INVALID'
  | 'ACCOUNT_UNAVAILABLE'
  | 'USERNAME_TAKEN'
  | 'INVITE_INVALID'
  | 'ALREADY_MEMBER'
  /** This person already came in once with this code (QA Faz 8 O6): a new code is needed. */
  | 'INVITE_USED'
  /** Whoever created a circle stays its admin (docs/ADR/0020). */
  | 'CREATOR_ADMIN'
  /** Location history needs the user's explicit consent first (docs/ADR/0022). */
  | 'CONSENT_REQUIRED'
  /** A new account says its age band first (docs/ADR/0023). */
  | 'AGE_REQUIRED'
  /** Not for 15-17 (location history, docs/ADR/0023). */
  | 'AGE_RESTRICTED'
  /** Older than said takes a person (or the age token), not a tap (docs/ADR/0023). */
  | 'AGE_REVIEW_REQUIRED'
  /** Someone 15-17 comes into an event only with a friend's code (docs/ADR/0023). */
  | 'FRIEND_INVITE_ONLY'
  /** Guardians (docs/ADR/0023 §4): a child is 15-17, a parent 18+, at most two parents. */
  | 'GUARDIAN_CHILD_ONLY'
  | 'GUARDIAN_ADULT_ONLY'
  | 'GUARDIAN_LIMIT'
  | 'ALREADY_GUARDIAN'
  | 'CIRCLE_FULL'
  | 'EPOCH_STALE'
  | 'KEYS_INVALID'
  | 'UNAVAILABLE'
  /** Someone saved a newer version first (places): read it again, then change that one. */
  | 'VERSION_CONFLICT'
  /** The circle already has as many places as allowed. */
  | 'PLACES_FULL'
  /** The event already has as many documents (meeting, polls, votes) as allowed. */
  | 'DOCS_FULL'
  | 'INTERNAL';

export class ApiError extends HttpException {
  constructor(
    readonly httpStatus: HttpStatus,
    readonly code: ApiErrorCode,
    /** Seconds the client should wait (429). */
    readonly retryAfter?: number,
  ) {
    super(code, httpStatus);
  }
}

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'VALIDATION_FAILED',
  415: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'UNAVAILABLE',
};

/**
 * One error shape for every failure: `{ statusCode, error, code }`. Messages, stack traces and
 * library details never reach the client; unexpected errors are logged by type only.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    // WebSocket handlers answer through their acknowledgement and never throw (events.gateway.ts).
    if (host.getType() !== 'http') return;
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'INTERNAL';
    let body: unknown;

    if (exception instanceof ApiError) {
      status = exception.httpStatus;
      code = exception.code;
      if (exception.retryAfter !== undefined) {
        void reply.header('retry-after', String(exception.retryAfter));
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      // Health reports are the one structured body the API returns with an error status.
      const response = exception.getResponse();
      if (status === 503 && typeof response === 'object' && 'checks' in response) body = response;
    } else if (isFastifyError(exception)) {
      status = exception.statusCode;
      code = CODE_BY_STATUS[status] ?? 'VALIDATION_FAILED';
    } else {
      this.logger.error(
        `Unhandled ${exception instanceof Error ? exception.name : typeof exception}`,
      );
    }

    void reply
      .status(status)
      .send(body ?? { statusCode: status, error: HttpStatus[status] ?? 'Error', code });
  }
}

function isFastifyError(value: unknown): value is { statusCode: number } {
  return (
    value instanceof Error &&
    'statusCode' in value &&
    typeof value.statusCode === 'number' &&
    value.statusCode >= 400 &&
    value.statusCode < 500
  );
}

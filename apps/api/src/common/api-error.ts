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
  | 'CIRCLE_FULL'
  | 'EPOCH_STALE'
  | 'KEYS_INVALID'
  | 'UNAVAILABLE'
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

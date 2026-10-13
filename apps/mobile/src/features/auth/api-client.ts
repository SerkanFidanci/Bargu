import { generateRequestNonce, signRequest, type DeviceKeys } from '@bargu/crypto';
import { SIGNED_REQUEST_HEADERS, type Session } from '@bargu/schemas';

/** Where the session lives: refresh token in the secure store, access token in memory. */
export interface SessionStore {
  get(): Session | null;
  set(session: Session | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  device: () => DeviceKeys | null;
  session: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const UNSIGNED_METHODS = new Set(['GET', 'HEAD']);
/** Refusals that mean the session is really over; anything else (network, clock) keeps it. */
const SESSION_ENDED = new Set(['REFRESH_INVALID', 'DEVICE_REVOKED', 'UNAUTHENTICATED']);

/**
 * Talks to the Bargu API the way it requires (docs/ADR/0005): bearer access token, every
 * state-changing request signed by the device identity key, and one transparent refresh when the
 * access token has expired. Concurrent requests share a single refresh (token rotation would
 * otherwise turn the second refresh into a reuse and end the session).
 */
export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let refreshing: Promise<Session> | null = null;
  /** Server time minus local time, learned from the Date header when the server reports skew. */
  let clockOffset = 0;

  function signedHeaders(method: string, path: string, body: string): Record<string, string> {
    const device = options.device();
    if (device === null) return {};
    const timestamp = now() + clockOffset;
    const nonce = generateRequestNonce();
    return {
      [SIGNED_REQUEST_HEADERS.signature]: signRequest(device.identity.secretKey, {
        method,
        path,
        timestamp,
        nonce,
        deviceId: device.deviceId,
        body: new TextEncoder().encode(body),
      }),
      [SIGNED_REQUEST_HEADERS.timestamp]: String(timestamp),
      [SIGNED_REQUEST_HEADERS.nonce]: nonce,
    };
  }

  async function send(
    path: string,
    request: RequestOptions,
    accessToken?: string,
    retriedSkew = false,
  ): Promise<unknown> {
    const method = request.method ?? 'GET';
    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const headers: Record<string, string> = {
      ...(body === '' ? {} : { 'content-type': 'application/json' }),
      ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      ...(UNSIGNED_METHODS.has(method) ? {} : signedHeaders(method, path, body)),
    };
    const response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers,
      ...(body === '' ? {} : { body }),
    });
    if (response.ok) {
      return response.status === 204 ? undefined : ((await response.json()) as unknown);
    }
    const error = (await response.json().catch(() => ({}))) as { code?: unknown };
    const code = typeof error.code === 'string' ? error.code : 'UNKNOWN';
    const serverTime = Date.parse(response.headers.get('date') ?? '');
    if (code === 'CLOCK_SKEW' && !retriedSkew && Number.isFinite(serverTime)) {
      // The phone's clock is off by more than the signature window: adopt the server's and retry.
      clockOffset = serverTime - now();
      return send(path, request, accessToken, true);
    }
    throw new ApiError(response.status, code);
  }

  function refresh(): Promise<Session> {
    refreshing ??= (async () => {
      const current = options.session.get();
      if (current === null) throw new ApiError(401, 'UNAUTHENTICATED');
      try {
        const next = (await send('/v1/auth/refresh', {
          method: 'POST',
          body: { refreshToken: current.refreshToken },
        })) as Session;
        await options.session.set(next);
        return next;
      } catch (error) {
        // Only a definitive refusal ends the session (logout, device change, reuse detected).
        if (error instanceof ApiError && SESSION_ENDED.has(error.code)) {
          await options.session.set(null);
        }
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    /** Unauthenticated call (login, code request). */
    public(path: string, request: RequestOptions = {}): Promise<unknown> {
      return send(path, request);
    },

    async authed(path: string, request: RequestOptions = {}): Promise<unknown> {
      const session = options.session.get();
      if (session === null) throw new ApiError(401, 'UNAUTHENTICATED');
      try {
        return await send(path, request, session.accessToken);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'TOKEN_EXPIRED')) throw error;
        const next = await refresh();
        return send(path, request, next.accessToken);
      }
    },
  };
}

import { CLIENT_LEVEL, CLIENT_LEVEL_QUERY, type LiveEvent, STREAM_EVENT } from '@bargu/schemas';
import { io } from 'socket.io-client';

import type { TransportFactory } from './event-stream';

/** Path of the event socket on the API (apps/api events.gateway EVENTS_PATH). */
export const EVENTS_PATH = '/v1/events';
/**
 * The live messages the app listens to, each a name the server sends (LIVE_EVENTS in
 * packages/schemas, apps/api relay.service). Every name the server sends is either here or in
 * INTENTIONALLY_NOT_LISTENED, and every name here has a handler: event-contract.test.ts fails
 * otherwise, so a new server message cannot be forgotten on the phone.
 */
export const LIVE_MESSAGES = [
  'loc',
  'loc.gone',
  'watch',
  'bump',
  // "Güvendeyim" (docs/ADR/0029)
  'safe',
  'status',
  'status.gone',
  'weather',
  'profile',
  // docs/ADR/0025
  'look',
  // "Neden eski?" (docs/ADR/0028)
  'state',
  'state.gone',
  // Arrivals, departures, "geç kalıyorum", "Geldim" (docs/ADR/0016, 0026): handled since Faz 7 but
  // never listened to, so an open app missed them (the server pushes only to closed apps).
  'place',
  // A friend's new quarter hour of history: an open history screen fetches again.
  'history',
] as const satisfies readonly LiveEvent[];

/**
 * Live messages the server sends that the app deliberately does not listen to, and why. Adding a
 * name here is a decision, not a way to silence the contract test: it must say what the app does
 * instead. A name listed here must have no handler (event-contract.test.ts).
 */
export const INTENTIONALLY_NOT_LISTENED = {
  'profile.gone':
    'The app keeps one photo per person, not per circle: someone who left one circle may still share another with this phone. People who left go from the map and lists through circle.changed / circle.gone, and a new photo (or none) comes as their next profile message.',
  'look.gone':
    'The app keeps one look per person, like the photo. It shows only for people on the map, who come and go with circle.changed / circle.gone, and their next look message replaces it.',
} as const satisfies Partial<Record<LiveEvent, string>>;

/** How long a request may take before the caller falls back (HTTP, or tries later). */
const REQUEST_TIMEOUT_MS = 5_000;
/** How long the server gets to answer `resume` before the phone reloads instead. */
const RESUME_TIMEOUT_MS = 10_000;

/**
 * Socket.io over WebSocket only. Dropped connections retry on their own with backoff up to 10 s
 * (BARGU_PLAN §3.4); every attempt signs a fresh handshake (one-time nonce, current token).
 */
export function socketTransport(
  url: string,
  handshake: (path: string) => Promise<Record<string, string>>,
): TransportFactory {
  return (handlers) => {
    const socket = io(url, {
      path: EVENTS_PATH,
      transports: ['websocket'],
      // In the query, not the auth object: older servers refuse unknown auth fields (QA 19 P4).
      query: { [CLIENT_LEVEL_QUERY]: String(CLIENT_LEVEL) },
      autoConnect: false,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      auth: (send) => {
        handshake(EVENTS_PATH).then(send, () => {
          // No usable session right now: the server refuses, and the stream retries later.
          send({});
        });
      },
    });
    socket.on('connect', () => {
      handlers.onConnect();
    });
    socket.on(STREAM_EVENT, (payload: unknown) => {
      handlers.onEvent(payload);
    });
    socket.on('connect_error', (error) => {
      // Inactive means the server refused (middleware); otherwise socket.io retries by itself.
      if (!socket.active) handlers.onDenied(error.message);
    });
    socket.on('disconnect', (reason) => {
      handlers.onDisconnect();
      if (reason === 'io server disconnect') handlers.onServerDisconnect();
    });
    for (const name of LIVE_MESSAGES) {
      socket.on(name, (payload: unknown) => {
        handlers.onLive(name, payload);
      });
    }
    return {
      get connected() {
        return socket.connected;
      },
      connect: () => {
        socket.connect();
      },
      disconnect: () => {
        socket.disconnect();
      },
      request: (name, payload) =>
        socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck(name, payload) as Promise<unknown>,
      resume: (lastEventId) =>
        socket
          .timeout(RESUME_TIMEOUT_MS)
          .emitWithAck('resume', { lastEventId }) as Promise<unknown>,
    };
  };
}

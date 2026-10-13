import { io } from 'socket.io-client';

import type { TransportFactory } from './event-stream';

/** Path of the event socket on the API (apps/api events.gateway EVENTS_PATH). */
export const EVENTS_PATH = '/v1/events';
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
    socket.on('event', (payload: unknown) => {
      handlers.onEvent(payload);
    });
    socket.on('connect_error', (error) => {
      // Inactive means the server refused (middleware); otherwise socket.io retries by itself.
      if (!socket.active) handlers.onDenied(error.message);
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') handlers.onServerDisconnect();
    });
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
      resume: (lastEventId) =>
        socket
          .timeout(RESUME_TIMEOUT_MS)
          .emitWithAck('resume', { lastEventId }) as Promise<unknown>,
    };
  };
}

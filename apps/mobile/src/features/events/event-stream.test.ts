import { randomUuid } from '@bargu/crypto';
import type { DeliveredEvent, ServerEvent } from '@bargu/schemas';

import type { KeyValueStore } from '../storage/vault';
import {
  compareEventIds,
  EventStream,
  LAST_EVENT_KEY,
  type Transport,
  type TransportHandlers,
  WAKE_GRACE_MS,
} from './event-stream';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key),
    set: (key, value) => {
      data.set(key, value);
    },
    delete: (key) => {
      data.delete(key);
    },
    keys: () => [...data.keys()],
    clear: () => {
      data.clear();
    },
  };
}

const circleId = randomUuid();
const changed = (epoch: number): ServerEvent => ({ type: 'circle.changed', circleId, epoch });
const delivered = (id: string, epoch: number): DeliveredEvent => ({
  id,
  at: Date.now(),
  event: changed(epoch),
});

/** Lets queued promises and zero-delay timers run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function setup(reply: () => Promise<unknown>) {
  let handlers: TransportHandlers | null = null;
  const transport = {
    connected: false as boolean,
    connect: jest.fn(),
    disconnect: jest.fn(),
    resume: jest.fn<Promise<unknown>, [string | null]>(() => reply()),
    request: jest.fn<Promise<unknown>, [string, unknown?]>(() => Promise.resolve({})),
  } satisfies Transport;
  const store = memoryStore();
  const applied: ServerEvent[][] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const clock = { now: 0 };
  const deps = {
    now: () => clock.now,
    transport: (h: TransportHandlers) => {
      handlers = h;
      return transport;
    },
    store,
    apply: jest.fn((events: ServerEvent[]) => {
      applied.push(events);
      return Promise.resolve();
    }),
    reload: jest.fn(() => Promise.resolve()),
    denied: jest.fn(),
    setTimer: (run: () => void, ms: number) => {
      timers.push({ run, ms });
      return timers.length;
    },
    clearTimer: jest.fn(),
    online: jest.fn<undefined, [boolean]>(),
    live: jest.fn<undefined, [string, unknown]>(),
  };
  const stream = new EventStream(deps);
  stream.start();
  const on = () => {
    if (handlers === null) throw new Error('not started');
    return handlers;
  };
  return { stream, transport, store, applied, deps, timers, on, clock };
}

describe('EventStream', () => {
  it('reloads on the first connection, then resumes from the cursor it was given', async () => {
    const { transport, store, deps, on } = setup(() =>
      Promise.resolve({ events: [], snapshot: true, cursor: '100-0' }),
    );
    expect(transport.connect).toHaveBeenCalledTimes(1);
    on().onConnect();
    await flush();
    expect(transport.resume).toHaveBeenCalledWith(null);
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(store.get(LAST_EVENT_KEY)).toBe('100-0');
  });

  it('applies what it missed in order and each event once', async () => {
    const replies = [
      { events: [], snapshot: true, cursor: '100-0' },
      {
        events: [delivered('101-0', 2), delivered('100-0', 1), delivered('102-0', 3)],
        snapshot: false,
        cursor: '102-0',
      },
    ];
    const { transport, applied, deps, on } = setup(() => Promise.resolve(replies.shift()));
    on().onConnect();
    await flush();
    on().onConnect();
    await flush();
    expect(transport.resume).toHaveBeenLastCalledWith('100-0');
    // 100-0 was already handled; the rest in id order.
    expect(applied).toEqual([[changed(2), changed(3)]]);
    expect(deps.reload).toHaveBeenCalledTimes(1);

    on().onEvent(delivered('102-0', 3));
    on().onEvent(delivered('103-0', 4));
    on().onEvent({ id: 'nonsense', event: { type: 'unknown' } });
    await flush();
    expect(applied).toEqual([[changed(2), changed(3)], [changed(4)]]);
  });

  it('holds events that arrive during the catch-up until the missed ones are applied', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    let first = true;
    const { applied, on } = setup(() => {
      if (first) {
        first = false;
        return Promise.resolve({ events: [], snapshot: true, cursor: '103-0' });
      }
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    on().onConnect();
    await flush();
    // Reconnected; while the server looks up what was missed, a new event arrives live.
    on().onConnect();
    await flush();
    on().onEvent(delivered('105-0', 5));
    answer({ events: [delivered('104-0', 4)], snapshot: false, cursor: '104-0' });
    await flush();
    expect(applied).toEqual([[changed(4), changed(5)]]);
  });

  it('reloads later when events could not be applied (nothing is silently lost)', async () => {
    const { store, deps, timers, on } = setup(() =>
      Promise.resolve({ events: [], snapshot: true, cursor: '1-0' }),
    );
    on().onConnect();
    await flush();
    deps.apply.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    on().onEvent(delivered('2-0', 2));
    await flush();
    expect(store.get(LAST_EVENT_KEY)).toBe('2-0');
    expect(timers).toHaveLength(1);
    timers[0]?.run();
    await flush();
    expect(deps.reload).toHaveBeenCalledTimes(2);
  });

  it('reports a refused handshake and tries again later; reconnects at once when the token ran out', async () => {
    const { transport, deps, timers, on } = setup(() =>
      Promise.resolve({ events: [], snapshot: true, cursor: null }),
    );
    on().onDenied('DEVICE_REVOKED');
    expect(deps.denied).toHaveBeenCalledWith('DEVICE_REVOKED');
    expect(timers).toHaveLength(1);
    timers[0]?.run();
    expect(transport.connect).toHaveBeenCalledTimes(2);

    on().onConnect();
    await flush();
    on().onServerDisconnect();
    expect(transport.connect).toHaveBeenCalledTimes(3);
  });

  it('on a wake-up, restarts a stalled connection but not one that just began', () => {
    const { stream, transport, clock } = setup(() => Promise.resolve(null));
    // start() just tried to connect: a wake-up now leaves that attempt alone.
    stream.wake();
    expect(transport.connect).toHaveBeenCalledTimes(1);
    clock.now = WAKE_GRACE_MS + 1;
    stream.wake();
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
    expect(transport.connect).toHaveBeenCalledTimes(2);
  });

  it('stops retrying once stopped', () => {
    const { stream, transport, timers, on } = setup(() => Promise.resolve(null));
    stream.stop();
    expect(transport.disconnect).toHaveBeenCalled();
    on().onDenied('UNAUTHENTICATED');
    expect(timers).toHaveLength(0);
  });
});

describe('compareEventIds', () => {
  it('orders stream ids numerically', () => {
    expect(compareEventIds('9-0', '10-0')).toBeLessThan(0);
    expect(compareEventIds('10-2', '10-10')).toBeLessThan(0);
    expect(compareEventIds('10-1', '10-1')).toBe(0);
    expect(compareEventIds('1700000000001-0', '1700000000000-5')).toBeGreaterThan(0);
  });

  it('says it is online only once caught up, and offline when the connection drops', async () => {
    const { deps, on } = setup(() =>
      Promise.resolve({ events: [], snapshot: true, cursor: '1-0' }),
    );
    on().onConnect();
    expect(deps.online).not.toHaveBeenCalled();
    await flush();
    expect(deps.online).toHaveBeenLastCalledWith(true);
    on().onDisconnect();
    expect(deps.online).toHaveBeenLastCalledWith(false);
  });

  it('passes live messages on and sends requests only while connected', async () => {
    const { stream, transport, deps, on } = setup(() =>
      Promise.resolve({ events: [], snapshot: true, cursor: '1-0' }),
    );
    on().onLive('loc', { envelope: 1 });
    expect(deps.live).toHaveBeenCalledWith('loc', { envelope: 1 });
    expect(stream.request('locations')).toBeNull();
    transport.connected = true;
    await expect(stream.request('locations')).resolves.toEqual({});
    expect(transport.request).toHaveBeenCalledWith('locations', undefined);
  });
});

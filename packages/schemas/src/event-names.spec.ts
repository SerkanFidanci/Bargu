import { describe, expect, it } from 'vitest';

import { serverEventSchema } from './circles.js';
import { LIVE_EVENTS, SERVER_EVENT_TYPES, STREAM_EVENT } from './event-names.js';

describe('event names (the contract between the server and the app)', () => {
  it('lists each live message once, and never under the stream name', () => {
    expect(new Set(LIVE_EVENTS).size).toBe(LIVE_EVENTS.length);
    expect((LIVE_EVENTS as readonly string[]).includes(STREAM_EVENT)).toBe(false);
  });

  it('has a message for every .gone', () => {
    const names: readonly string[] = LIVE_EVENTS;
    for (const name of names.filter((candidate) => candidate.endsWith('.gone'))) {
      expect(names).toContain(name.slice(0, -'.gone'.length));
    }
  });

  it('lists every durable event type of the schema, once', () => {
    expect(SERVER_EVENT_TYPES).toHaveLength(serverEventSchema.options.length);
    expect(new Set(SERVER_EVENT_TYPES).size).toBe(SERVER_EVENT_TYPES.length);
    for (const type of SERVER_EVENT_TYPES) expect(typeof type).toBe('string');
  });
});

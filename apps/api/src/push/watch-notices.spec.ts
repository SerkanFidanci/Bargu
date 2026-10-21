import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env.js';
import type { RedisClient } from '../infra/redis/redis.client.js';
import type { Notifier } from './notifier.js';
import { WATCH_WINDOW_MS, watchNoticesKey, WatchNotices } from './watch-notices.js';

const circle = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const bora = '0190f7a4-1111-7111-8111-000000000b0b';
const can = '0190f7a4-1111-7111-8111-0000000ca201';
const NOW = 1_800_000_000_000;

interface Call {
  keys: string[];
  arguments: string[];
}

function setup(
  env: Partial<Pick<Env, 'WATCH_PUSH' | 'WATCH_PUSH_MIN_SECONDS' | 'WATCH_PUSH_PER_HOUR'>> = {},
  options: { enabled?: boolean; refused?: (key: string) => boolean } = {},
) {
  const calls: Call[] = [];
  const redis = {
    eval: vi.fn((_script: string, call: Call) => {
      calls.push(call);
      return Promise.resolve(options.refused?.(call.keys[0] ?? '') === true ? 0 : 1);
    }),
  } as unknown as RedisClient;
  const notifyWatch = vi.fn(() => Promise.resolve());
  const notifier = { enabled: options.enabled ?? true, notifyWatch } as unknown as Notifier;
  const notices = new WatchNotices(
    {
      WATCH_PUSH: 'on',
      WATCH_PUSH_MIN_SECONDS: 90,
      WATCH_PUSH_PER_HOUR: 20,
      ...env,
    } as Env,
    redis,
    notifier,
  );
  return { notices, calls, notifyWatch, redis };
}

describe('WatchNotices (the allowance itself is tried against Redis in watch-push.int-spec)', () => {
  it('asks Redis once per recipient with the configured gap and limit over a sliding hour', async () => {
    const { notices, calls, notifyWatch } = setup({
      WATCH_PUSH_MIN_SECONDS: 120,
      WATCH_PUSH_PER_HOUR: 7,
    });
    expect(await notices.tell(circle, [bora, can, bora], NOW)).toEqual([bora, can]);
    expect(calls).toEqual([
      {
        keys: [watchNoticesKey(bora)],
        arguments: [String(NOW), '120000', '7', String(WATCH_WINDOW_MS)],
      },
      {
        keys: [watchNoticesKey(can)],
        arguments: [String(NOW), '120000', '7', String(WATCH_WINDOW_MS)],
      },
    ]);
    expect(WATCH_WINDOW_MS).toBe(60 * 60_000);
    expect(notifyWatch).toHaveBeenCalledTimes(2);
    expect(notifyWatch).toHaveBeenCalledWith(bora, circle);
    expect(notifyWatch).toHaveBeenCalledWith(can, circle);
  });

  it('skips a recipient Redis refuses and still tells the rest', async () => {
    const { notices, notifyWatch } = setup({}, { refused: (key) => key === watchNoticesKey(bora) });
    expect(await notices.tell(circle, [bora, can], NOW)).toEqual([can]);
    expect(notifyWatch).toHaveBeenCalledTimes(1);
    expect(notifyWatch).toHaveBeenCalledWith(can, circle);
  });

  it('judges the allowance at the time it is given, now by default', async () => {
    const { notices, calls } = setup();
    const before = Date.now();
    await notices.tell(circle, [bora]);
    const at = Number(calls[0]?.arguments[0]);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('does nothing while the switch is off or no push service is configured', async () => {
    const off = setup({ WATCH_PUSH: 'off' });
    expect(off.notices.enabled).toBe(false);
    expect(await off.notices.tell(circle, [bora], NOW)).toEqual([]);
    expect(off.redis.eval).not.toHaveBeenCalled();
    expect(off.notifyWatch).not.toHaveBeenCalled();
    const noPush = setup({}, { enabled: false });
    expect(noPush.notices.enabled).toBe(false);
    expect(await noPush.notices.tell(circle, [bora], NOW)).toEqual([]);
    expect(noPush.notifyWatch).not.toHaveBeenCalled();
  });

  it('never fails the watch that caused it: not when the queue is down, nor when Redis is', async () => {
    const queue = setup();
    queue.notifyWatch.mockRejectedValueOnce(new Error('queue down'));
    await expect(queue.notices.tell(circle, [bora], NOW)).resolves.toEqual([]);
    const redis = setup();
    vi.mocked(redis.redis.eval).mockRejectedValueOnce(new Error('redis down'));
    await expect(redis.notices.tell(circle, [bora, can], NOW)).resolves.toEqual([]);
    expect(redis.notifyWatch).not.toHaveBeenCalled();
  });
});

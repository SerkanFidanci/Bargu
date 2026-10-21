import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env.js';
import type { RateLimiter } from '../infra/redis/rate-limiter.js';
import type { Notifier } from './notifier.js';
import { WatchNotices } from './watch-notices.js';

const circle = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const bora = '0190f7a4-1111-7111-8111-000000000b0b';
const can = '0190f7a4-1111-7111-8111-0000000ca201';

function setup(
  env: Partial<Pick<Env, 'WATCH_PUSH' | 'WATCH_PUSH_MIN_SECONDS' | 'WATCH_PUSH_PER_HOUR'>> = {},
  options: { enabled?: boolean; blocked?: (key: string) => boolean } = {},
) {
  const hits: [string, number, number][] = [];
  const limiter = {
    hit: vi.fn((key: string, limit: number, window: number) => {
      hits.push([key, limit, window]);
      return Promise.resolve({ allowed: !(options.blocked?.(key) ?? false), retryAfter: 1 });
    }),
  } as unknown as RateLimiter;
  const notifyWatch = vi.fn(() => Promise.resolve());
  const notifier = { enabled: options.enabled ?? true, notifyWatch } as unknown as Notifier;
  const notices = new WatchNotices(
    {
      WATCH_PUSH: 'on',
      WATCH_PUSH_MIN_SECONDS: 90,
      WATCH_PUSH_PER_HOUR: 20,
      ...env,
    } as Env,
    limiter,
    notifier,
  );
  return { notices, hits, notifyWatch };
}

describe('WatchNotices', () => {
  it('counts per recipient with the configured limits and queues one notice each', async () => {
    const { notices, hits, notifyWatch } = setup({
      WATCH_PUSH_MIN_SECONDS: 120,
      WATCH_PUSH_PER_HOUR: 7,
    });
    expect(await notices.tell(circle, [bora, can, bora])).toEqual([bora, can]);
    expect(hits).toEqual([
      [`watch-push:gap:${bora}`, 1, 120],
      [`watch-push:hour:${bora}`, 7, 3_600],
      [`watch-push:gap:${can}`, 1, 120],
      [`watch-push:hour:${can}`, 7, 3_600],
    ]);
    expect(notifyWatch).toHaveBeenCalledTimes(2);
    expect(notifyWatch).toHaveBeenCalledWith(bora, circle);
    expect(notifyWatch).toHaveBeenCalledWith(can, circle);
  });

  it('skips a recipient over either limit and still tells the rest', async () => {
    const gap = setup({}, { blocked: (key) => key.includes(`gap:${bora}`) });
    expect(await gap.notices.tell(circle, [bora, can])).toEqual([can]);
    const hour = setup({}, { blocked: (key) => key.includes(`hour:${can}`) });
    expect(await hour.notices.tell(circle, [bora, can])).toEqual([bora]);
    expect(hour.notifyWatch).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the switch is off or no push service is configured', async () => {
    const off = setup({ WATCH_PUSH: 'off' });
    expect(off.notices.enabled).toBe(false);
    expect(await off.notices.tell(circle, [bora])).toEqual([]);
    expect(off.hits).toEqual([]);
    expect(off.notifyWatch).not.toHaveBeenCalled();
    const noPush = setup({}, { enabled: false });
    expect(noPush.notices.enabled).toBe(false);
    expect(await noPush.notices.tell(circle, [bora])).toEqual([]);
    expect(noPush.notifyWatch).not.toHaveBeenCalled();
  });

  it('never fails the watch that caused it', async () => {
    const { notices, notifyWatch } = setup();
    notifyWatch.mockRejectedValueOnce(new Error('queue down'));
    await expect(notices.tell(circle, [bora])).resolves.toEqual([]);
  });
});

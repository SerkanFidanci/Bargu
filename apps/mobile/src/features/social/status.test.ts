import { statusOf, type ReceivedStatus } from './status-model';

const NOW = 1_800_000_000_000;
const entry = (circleId: string, ts: number, expiresAt: number, emoji: string): ReceivedStatus => ({
  circleId,
  userId: 'ada',
  status: { kind: 'status', emoji, expiresAt, ts },
});

describe('statuses', () => {
  it('shows the newest status that has not ended, over all shared circles', () => {
    const statuses = {
      'a:ada': entry('a', NOW - 5_000, NOW + 60_000, '☕'),
      'b:ada': entry('b', NOW - 1_000, NOW + 60_000, '🚗'),
      'c:ada': entry('c', NOW, NOW - 1, '😴'),
    };
    expect(statusOf(statuses, 'ada', NOW)?.emoji).toBe('🚗');
    expect(statusOf(statuses, 'ada', NOW + 60_000)).toBeNull();
    expect(statusOf(statuses, 'someone else', NOW)).toBeNull();
  });
});

const mockScheduled: { identifier: string }[] = [];
const mockCancel = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const mockSchedule = jest.fn<Promise<string>, [{ identifier: string }]>(() =>
  Promise.resolve('id'),
);
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: (request: { identifier: string }) => mockSchedule(request),
  getAllScheduledNotificationsAsync: () => Promise.resolve(mockScheduled),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
}));

import { cancelAllShareEnds, reconcileShareEnds } from './share-ends';

beforeEach(() => {
  mockScheduled.length = 0;
  jest.clearAllMocks();
});

describe("the phone's own lines for a timed share's end (QA-42)", () => {
  it('go all at sign-out, and nothing else this phone set', async () => {
    mockScheduled.push(
      { identifier: 'share-end:a' },
      { identifier: 'trial-ends' },
      { identifier: 'share-end:b' },
      { identifier: 'sharing-review' },
    );
    await cancelAllShareEnds();
    expect(mockCancel.mock.calls.map(([id]) => id)).toEqual(['share-end:a', 'share-end:b']);
  });

  it('follow the friendships: an ended or paused one loses its line, a resumed one gets it again (QA-43)', async () => {
    mockScheduled.push(
      { identifier: 'share-end:gone' },
      { identifier: 'share-end:kept' },
      { identifier: 'trial-ends' },
    );
    const text = { title: 'Bargu', body: 'Ayşe artık seni görmüyor' };
    await reconcileShareEnds([
      { circleId: 'kept', at: 2_000, text },
      { circleId: 'resumed', at: 3_000, text },
    ]);
    expect(mockCancel.mock.calls.map(([id]) => id)).toEqual(['share-end:gone']);
    expect(mockSchedule.mock.calls.map(([request]) => request.identifier)).toEqual([
      'share-end:resumed',
    ]);
  });
});

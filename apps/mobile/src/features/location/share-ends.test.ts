const mockScheduled: { identifier: string }[] = [];
const mockCancel = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  getAllScheduledNotificationsAsync: () => Promise.resolve(mockScheduled),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
}));

import { cancelAllShareEnds } from './share-ends';

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
});

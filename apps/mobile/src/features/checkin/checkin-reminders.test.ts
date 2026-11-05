import { hideOpenNotice, showOpenNotice } from './checkin-reminders';

const mockSchedule = jest.fn<Promise<string>, [unknown]>();
const mockDismiss = jest.fn<Promise<void>, [string]>();
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (request: unknown) => mockSchedule(request),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

beforeEach(() => {
  mockSchedule.mockReset();
  mockDismiss.mockReset();
});

describe('persistent own-check notification reconciliation (QA-45)', () => {
  it('lets a later hide win even when scheduling finishes first', async () => {
    let visible = false;
    const scheduling = deferred<undefined>();
    const dismissing = deferred<undefined>();
    mockSchedule.mockImplementationOnce(async () => {
      await scheduling.promise;
      visible = true;
      return 'checkin-open';
    });
    mockDismiss.mockImplementationOnce(async () => {
      await dismissing.promise;
      visible = false;
    });

    const showing = showOpenNotice({ title: 'Open', body: 'Tap arrived' });
    await flush();
    const hiding = hideOpenNotice();
    scheduling.resolve(undefined);
    await showing;
    await flush();
    dismissing.resolve(undefined);
    await hiding;
    expect(visible).toBe(false);
    expect(mockDismiss).toHaveBeenCalledWith('checkin-open');
  });

  it('lets a later show win even when the earlier dismiss finishes first', async () => {
    let visible = true;
    const dismissing = deferred<undefined>();
    const scheduling = deferred<undefined>();
    mockDismiss.mockImplementationOnce(async () => {
      await dismissing.promise;
      visible = false;
    });
    mockSchedule.mockImplementationOnce(async () => {
      await scheduling.promise;
      visible = true;
      return 'checkin-open';
    });

    const hiding = hideOpenNotice();
    await flush();
    const showing = showOpenNotice({ title: 'Open again', body: 'Tap arrived' });
    dismissing.resolve(undefined);
    await hiding;
    await flush();
    scheduling.resolve(undefined);
    await showing;
    expect(visible).toBe(true);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });
});

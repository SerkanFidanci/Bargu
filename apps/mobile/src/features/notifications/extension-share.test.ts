const mockItems = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  setItemAsync: jest.fn((item: string, value: string) => {
    mockItems.set(item, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((item: string) => {
    mockItems.delete(item);
    return Promise.resolve();
  }),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { iosPushKeychainGroup: 'group.test' } } },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { clearExtensionShare, EXTENSION_ITEMS, shareMutesWithExtension } from './extension-share';
import { NO_MUTES, withPersonMuted } from './mutes';

describe('the notification extension copy of the mutes (iPhone)', () => {
  it('is kept for the extension, and is gone when the session ends', async () => {
    const mutes = withPersonMuted(NO_MUTES, 'someone-no-circle-is-shared-with', { pokes: true });
    await shareMutesWithExtension(mutes);
    expect(JSON.parse(mockItems.get(EXTENSION_ITEMS.mutes) ?? 'null')).toEqual(mutes);

    // Sign-out and account deletion (places-session clears it with everything else shared).
    await clearExtensionShare();
    expect(mockItems.size).toBe(0);
  });
});

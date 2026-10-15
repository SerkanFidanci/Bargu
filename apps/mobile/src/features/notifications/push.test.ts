import { enablePush, usePushState } from './push';

interface Permission {
  granted: boolean;
  canAskAgain: boolean;
}
const mockGetPermissions = jest.fn<Promise<Permission>, []>();
const mockRequestPermissions = jest.fn<Promise<Permission>, []>();
const mockToken = jest.fn<Promise<{ type: string; data: unknown }>, []>();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getDevicePushTokenAsync: () => mockToken(),
}));

const register = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const run = () =>
  enablePush({
    register,
    channelName: 'Arkadaşlar ve çemberler',
    placesChannelName: 'Varışlar ve ayrılışlar',
    meetingsChannelName: 'Buluşmalar',
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockToken.mockResolvedValue({ type: 'android', data: 'fcm-token' });
});

describe('enablePush', () => {
  it('asks right away while the user has not decided, then registers this phone', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(run()).resolves.toBe('enabled');
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('fcm-token');
    expect(usePushState.getState().state).toBe('enabled');
  });

  it('does not ask again once allowed, and keeps the token current', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(run()).resolves.toBe('enabled');
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledWith('fcm-token');
  });

  it('respects a refusal: no nagging, nothing registered', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(run()).resolves.toBe('denied');
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(usePushState.getState().state).toBe('denied');
  });

  it('keeps working without a push service in the build (in-app notices only)', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockToken.mockRejectedValue(new Error('No Firebase app'));
    await expect(run()).resolves.toBe('unavailable');
    expect(register).not.toHaveBeenCalled();
  });
});

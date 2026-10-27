import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { enablePush, routeOfResponse, usePushState } from './push';

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
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getDevicePushTokenAsync: () => mockToken(),
}));

const register = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const run = (ask = true) =>
  enablePush({
    register,
    channelName: 'Arkadaşlar ve çemberler',
    placesChannelName: 'Varışlar ve ayrılışlar',
    meetingsChannelName: 'Buluşmalar',
    privacyChannelName: 'Gizlilik hatırlatmaları',
    accountChannelName: 'Hesap ve Bargu+',
    safeQuietChannelName: 'Güvendeyim (sessiz özet)',
    ask,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockToken.mockResolvedValue({ type: 'android', data: 'fcm-token' });
});

describe('enablePush', () => {
  it('does not ask by itself: the question waits for its moment (Google Play K11)', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    await expect(run(false)).resolves.toBe('undetermined');
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(usePushState.getState().state).toBe('undetermined');
  });

  it('asks when the user turns them on while undecided, then registers this phone', async () => {
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

  it('makes the quiet channel of "Güvendeyim" summaries without sound or vibration (Android)', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    const was = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      await run();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: was, configurable: true });
    }
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('safe-quiet', {
      name: 'Güvendeyim (sessiz özet)',
      importance: 2,
      sound: null,
      enableVibrate: false,
    });
    // The loud channel of friends and circles is the one that makes a noise.
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('social', {
      name: 'Arkadaşlar ve çemberler',
      importance: 4,
    });
  });

  it('keeps working without a push service in the build (in-app notices only)', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockToken.mockRejectedValue(new Error('No Firebase app'));
    await expect(run()).resolves.toBe('unavailable');
    expect(register).not.toHaveBeenCalled();
  });
});

describe('routeOfResponse', () => {
  const tapped = (data: Record<string, unknown>) =>
    routeOfResponse({
      notification: { request: { content: { data } } },
    } as unknown as Notifications.NotificationResponse);

  it('opens the conversation of a new message, or the list when it names none (docs/ADR/0035 §11)', () => {
    const conversation = 'c:0190f7a4-2222-7222-8222-000000000001';
    expect(tapped({ route: 'messages', conversation })).toBe(`/messages/${conversation}`);
    expect(tapped({ route: 'messages', conversation: '../store' })).toBe('/messages');
    expect(tapped({ route: 'messages' })).toBe('/messages');
    expect(tapped({ route: 'guardians' })).toBe('/guardians');
    expect(tapped({ route: 'elsewhere' })).toBeNull();
  });
});

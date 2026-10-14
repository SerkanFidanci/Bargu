import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/features/auth/api-client';
import i18n from '@/i18n';
import { orbit } from '@/theme';

const mockClipboard = jest.fn<Promise<string>, []>();
jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockClipboard() }));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));

const mockRequestCode = jest.fn();
const mockVerifyCode = jest.fn();
const mockPasskeySignIn = jest.fn();
jest.mock('@/features/auth/auth-store', () => ({
  requestCode: (...args: unknown[]) => mockRequestCode(...args) as unknown,
  verifyCode: (...args: unknown[]) => mockVerifyCode(...args) as unknown,
  signInWithPasskey: () => mockPasskeySignIn() as unknown,
}));
jest.mock('@/features/auth/passkey-support', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/features/auth/passkey-support'),
  passkeysSupported: () => true,
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams = {
  email: 'ayse@example.test',
  challengeId: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
};
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args) as unknown,
    back: () => mockBack() as unknown,
  },
  useLocalSearchParams: () => mockParams,
}));

import CodeScreen from '@/app/(auth)/code';
import EmailScreen from '@/app/(auth)/email';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  jest.clearAllMocks();
});

describe('email step', () => {
  it('explains an invalid address without calling the server', async () => {
    await render(<EmailScreen />);
    await fireEvent.changeText(screen.getByLabelText('E-posta'), 'ayse@');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod gönder' }));
    expect(screen.getByText('Geçerli bir e-posta adresi yaz.')).toBeTruthy();
    expect(mockRequestCode).not.toHaveBeenCalled();
  });

  it('asks for a code and moves to the code step with the challenge', async () => {
    mockRequestCode.mockResolvedValue({ challengeId: mockParams.challengeId, expiresIn: 600 });
    await render(<EmailScreen />);
    await fireEvent.changeText(screen.getByLabelText('E-posta'), '  ayse@example.test ');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod gönder' }));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/code',
        params: {
          email: 'ayse@example.test',
          challengeId: mockParams.challengeId,
          expiresIn: '600',
        },
      });
    });
    expect(mockRequestCode).toHaveBeenCalledWith('ayse@example.test');
  });

  it('tells the user to wait when the server rate-limits', async () => {
    mockRequestCode.mockRejectedValue(new ApiError(429, 'RATE_LIMITED'));
    await render(<EmailScreen />);
    await fireEvent.changeText(screen.getByLabelText('E-posta'), 'ayse@example.test');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod gönder' }));
    expect(
      await screen.findByText('Çok fazla deneme oldu. Biraz bekleyip tekrar dene.'),
    ).toBeTruthy();
  });

  it('says so when there is no network', async () => {
    mockRequestCode.mockRejectedValue(new TypeError('Network request failed'));
    await render(<EmailScreen />);
    await fireEvent.changeText(screen.getByLabelText('E-posta'), 'ayse@example.test');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod gönder' }));
    expect(
      await screen.findByText('Bağlantı yok. İnternetini kontrol edip tekrar dene.'),
    ).toBeTruthy();
  });
});

describe('passkey sign-in', () => {
  it('signs in with the passkey when the phone has one', async () => {
    mockPasskeySignIn.mockResolvedValue({});
    await render(<EmailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Passkey ile giriş yap' }));
    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledTimes(1);
    });
  });

  it('points to the email code when there is no passkey on this phone', async () => {
    mockPasskeySignIn.mockRejectedValue({ error: 'NoCredentials', message: 'none' });
    await render(<EmailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Passkey ile giriş yap' }));
    expect(await screen.findByText(/kayıtlı passkey yok/)).toBeTruthy();
  });

  it('says nothing when the user cancels the system prompt', async () => {
    mockPasskeySignIn.mockRejectedValue({ error: 'UserCancelled', message: 'cancelled' });
    await render(<EmailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Passkey ile giriş yap' }));
    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalled();
    });
    expect(screen.queryByText(/passkey/i, { exact: false })).toBeTruthy();
    expect(screen.queryByText('Passkey ile giriş olmadı. E-posta koduyla dene.')).toBeNull();
  });
});

describe('code step', () => {
  // The resend countdown ticks every second: fake timers keep its updates inside each test.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('verifies as soon as all 4 digits are in', async () => {
    mockVerifyCode.mockResolvedValue({});
    await render(<CodeScreen />);
    await fireEvent.changeText(screen.getByLabelText('Giriş kodu, 4 hane'), '1234');
    await waitFor(() => {
      expect(mockVerifyCode).toHaveBeenCalledWith(mockParams.challengeId, '1234');
    });
  });

  it.each([
    ['OTP_INVALID', 'Kod yanlış. Tekrar dene.'],
    ['OTP_EXPIRED', 'Bu kodun süresi doldu. Yeni bir kod iste.'],
    ['OTP_LOCKED', 'Çok fazla yanlış deneme. Yeni bir kod iste.'],
  ])('explains %s and clears the boxes', async (code, message) => {
    mockVerifyCode.mockRejectedValue(new ApiError(400, code));
    await render(<CodeScreen />);
    const field = screen.getByLabelText('Giriş kodu, 4 hane');
    await fireEvent.changeText(field, '1234');
    expect(await screen.findByText(message)).toBeTruthy();
    // The wrong code stays red for a moment, then the boxes empty for another try.
    await act(async () => {
      jest.advanceTimersByTime(orbit.errorHold);
      await Promise.resolve();
    });
    expect(screen.getByLabelText('Giriş kodu, 4 hane').props.value).toBe('');
  });

  it('pastes a code copied from the email, only when asked', async () => {
    mockVerifyCode.mockResolvedValue({});
    mockClipboard.mockResolvedValue('Bargu giriş kodun: 4719. 10 dakika geçerli.');
    await render(<CodeScreen />);
    expect(mockClipboard).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Kopyaladığın kodu yapıştır' }));
    await waitFor(() => {
      expect(mockVerifyCode).toHaveBeenCalledWith(mockParams.challengeId, '4719');
    });
  });

  it('holds back a new code for a minute, then sends one for the same address', async () => {
    mockRequestCode.mockResolvedValue({
      challengeId: '0190f7a4-5b6c-7d8e-9f01-000000000000',
      expiresIn: 600,
    });
    await render(<CodeScreen />);
    const waiting = screen.getByRole('button', { name: '60 sn sonra tekrar gönderebilirsin' });
    expect(waiting.props.accessibilityState).toMatchObject({ disabled: true });
    for (let second = 0; second < 60; second++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Kodu tekrar gönder' }));
    expect(mockRequestCode).toHaveBeenCalledWith('ayse@example.test');
  });
});

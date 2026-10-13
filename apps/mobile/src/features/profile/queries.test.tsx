import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { typingDebounceMs } from '@/theme';

const mockAuthed = jest.fn();
jest.mock('../auth/auth-store', () => ({
  api: { authed: (...args: unknown[]) => mockAuthed(...args) as unknown },
  useAuth: (select: (state: { status: string }) => unknown) => select({ status: 'signedIn' }),
}));

import { isProfileComplete, useUsernameCheck } from './queries';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAuthed.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(typingDebounceMs + 10);
  });
}

describe('username check while typing', () => {
  it('rejects bad formats and reserved names on the phone, without asking the server', async () => {
    const { result, rerender } = await renderHook(
      ({ input }: { input: string }) => useUsernameCheck(input),
      { wrapper, initialProps: { input: 'ay' } },
    );
    await settle();
    expect(result.current).toEqual({
      state: 'done',
      result: { username: 'ay', available: false, reason: 'invalid' },
    });
    await rerender({ input: 'Destek' });
    await settle();
    expect(result.current).toMatchObject({ state: 'done', result: { reason: 'reserved' } });
    expect(mockAuthed).not.toHaveBeenCalled();
  });

  it('asks the server once typing pauses, for the normalised name', async () => {
    mockAuthed.mockResolvedValue({ username: 'ayse.k', available: false, reason: 'taken' });
    const { result, rerender } = await renderHook(
      ({ input }: { input: string }) => useUsernameCheck(input),
      { wrapper, initialProps: { input: '' } },
    );
    await rerender({ input: '@Ayse.K' });
    expect(result.current).toEqual({ state: 'checking', username: 'ayse.k' });
    expect(mockAuthed).not.toHaveBeenCalled();
    await settle();
    expect(mockAuthed).toHaveBeenCalledWith('/v1/usernames/availability?username=ayse.k');
    await waitFor(() => {
      expect(result.current).toMatchObject({ state: 'done', result: { reason: 'taken' } });
    });
  });

  it('is empty before anything is typed', async () => {
    const { result } = await renderHook(() => useUsernameCheck('  '), { wrapper });
    expect(result.current).toEqual({ state: 'empty' });
  });
});

describe('profile completeness', () => {
  const base = {
    userId: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
    avatar: null,
    device: {
      id: '0190f7a4-5b6c-7d8e-9f01-23456789abce',
      platform: 'android' as const,
      attested: false,
    },
    passkeys: 0,
  };

  it('needs both a username and a display name', () => {
    expect(isProfileComplete({ ...base, username: 'ayse', displayName: null })).toBe(false);
    expect(isProfileComplete({ ...base, username: null, displayName: 'Ayşe' })).toBe(false);
    expect(isProfileComplete({ ...base, username: 'ayse', displayName: 'Ayşe' })).toBe(true);
  });
});

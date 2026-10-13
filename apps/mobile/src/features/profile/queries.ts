import {
  isReservedUsername,
  type Me,
  meSchema,
  normalizeUsername,
  type ProfileUpdate,
  USERNAME_PATTERN,
  type UsernameAvailability,
  usernameAvailabilitySchema,
} from '@bargu/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { typingDebounceMs } from '@/theme';
import { toast } from '@/ui/toast';

import { ApiError } from '../auth/api-client';
import { api, useAuth } from '../auth/auth-store';
import { errorMessage, isApiError } from '../errors';

export const meKey = ['me'] as const;

/** The signed-in profile; loaded once, then kept current by mutation responses (no polling). */
export function useMe() {
  const signedIn = useAuth((state) => state.status === 'signedIn');
  return useQuery({
    queryKey: meKey,
    queryFn: async () => meSchema.parse(await api.authed('/v1/me')),
    enabled: signedIn,
    // Offline or server trouble at start: keep trying with backoff (max 10 s, BARGU_PLAN §3.4);
    // a refusal (4xx) will not change on retry.
    retry: (_failures, error) => !(error instanceof ApiError) || error.status >= 500,
    retryDelay: (failures) => Math.min(1000 * 2 ** failures, 10_000),
  });
}

/** A profile is complete once it has a username and a display name (end of onboarding). */
export function isProfileComplete(me: Me): boolean {
  return me.username !== null && me.displayName !== null;
}

/**
 * Saves profile fields. Optimistic by default: the screen updates at once, a refusal rolls it back
 * with a toast (BARGU_PLAN §3.4). Onboarding waits for the server instead
 * (`optimistic: false`), because the saved profile decides which screen comes next. A taken username is left to the
 * caller to explain in place.
 */
export function useUpdateProfile({ optimistic = true }: { optimistic?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: async (update: ProfileUpdate) =>
      meSchema.parse(await api.authed('/v1/me', { method: 'PATCH', body: update })),
    onMutate: async (update) => {
      if (!optimistic) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: meKey });
      const previous = queryClient.getQueryData<Me>(meKey);
      if (previous !== undefined) {
        queryClient.setQueryData<Me>(meKey, {
          ...previous,
          ...(update.username === undefined
            ? {}
            : { username: normalizeUsername(update.username) }),
          ...(update.displayName === undefined ? {} : { displayName: update.displayName }),
          ...(update.avatar === undefined ? {} : { avatar: update.avatar }),
        });
      }
      return { previous };
    },
    onError: (error, _update, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(meKey, context.previous);
      if (!isApiError(error, 'USERNAME_TAKEN')) toast.error(errorMessage(error, t));
    },
    onSuccess: (me) => {
      queryClient.setQueryData(meKey, me);
    },
  });
}

export type UsernameCheck =
  | { state: 'empty' }
  | { state: 'checking'; username: string }
  | { state: 'unknown'; username: string }
  | { state: 'done'; result: UsernameAvailability };

/**
 * Live availability while typing: format and reserved names are checked on the phone at once;
 * the server is asked only for well-formed names, after a short pause in typing.
 */
export function useUsernameCheck(input: string): UsernameCheck {
  const username = normalizeUsername(input);
  const [settled, setSettled] = useState(username);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(username);
    }, typingDebounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [username]);

  const local: UsernameAvailability | null = !USERNAME_PATTERN.test(username)
    ? { username, available: false, reason: 'invalid' }
    : isReservedUsername(username)
      ? { username, available: false, reason: 'reserved' }
      : null;

  const query = useQuery({
    queryKey: ['username-availability', settled],
    queryFn: async () =>
      usernameAvailabilitySchema.parse(
        await api.authed(`/v1/usernames/availability?username=${encodeURIComponent(settled)}`),
      ),
    enabled: local === null && settled === username && username.length > 0,
    staleTime: 30_000,
    gcTime: 60_000,
  });

  if (username.length === 0) return { state: 'empty' };
  if (local !== null) return { state: 'done', result: local };
  if (query.data?.username === username) {
    return { state: 'done', result: query.data };
  }
  if (query.isError) return { state: 'unknown', username };
  return { state: 'checking', username };
}

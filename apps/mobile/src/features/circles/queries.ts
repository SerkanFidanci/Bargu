import type { Circle, CircleCreate } from '@bargu/schemas';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { errorMessage, isApiError } from '../errors';
import { circleSync } from '../live/live-session';
import { circlesKey } from './circle-cache';
import { circlesApi } from './circles-api';
import { type Friend, friendsOf, handleOf, memberName, partnerOf } from './names';

export { type Friend, friendsOf, handleOf, memberName, partnerOf };

/** Every circle the user is in or invited to; loaded once, then kept current by events. */
export function useCircles() {
  const signedIn = useAuth((state) => state.status === 'signedIn');
  return useQuery({ queryKey: circlesKey, queryFn: () => circlesApi.list(), enabled: signedIn });
}

/** One circle from the cached list (no request of its own). */
export function useCircle(circleId: string): Circle | undefined {
  return useCircles().data?.find((circle) => circle.id === circleId);
}

/** The circles grouped the way the circles sheet shows them. */
export function groupCircles(circles: readonly Circle[]) {
  return {
    requests: circles.filter((circle) => circle.myStatus === 'invited'),
    friends: circles.filter((circle) => circle.kind === 'pair' && circle.myStatus === 'active'),
    groups: circles.filter((circle) => circle.kind !== 'pair' && circle.myStatus === 'active'),
  };
}

/** Error toast for a failed circle action; specific codes get their own sentence. */
function useFailure() {
  const { t } = useTranslation();
  return (error: unknown) => {
    feedback('error');
    if (isApiError(error, 'CIRCLE_FULL')) toast.error(t('circles.errors.full'));
    else if (isApiError(error, 'NOT_FOUND')) toast.error(t('circles.errors.gone'));
    else toast.error(errorMessage(error, t));
  };
}

/**
 * The user's own circle actions. Each updates the cache from the server's answer and runs key
 * exchange for the circle; other people's phones hear about it through events.
 */
export function useCircleActions() {
  const onError = useFailure();
  const adopt = (circle: Circle) => {
    void circleSync.adopt(circle).catch(() => undefined);
    return circle;
  };
  return {
    accept: useMutation({
      mutationFn: async (circleId: string) => adopt(await circlesApi.accept(circleId)),
      onSuccess: () => {
        feedback('success');
      },
      onError,
    }),
    decline: useMutation({
      mutationFn: async (circleId: string) => {
        await circlesApi.decline(circleId);
        circleSync.drop(circleId);
      },
      onError,
    }),
    leave: useMutation({
      mutationFn: async (circleId: string) => {
        await circlesApi.leave(circleId);
        circleSync.drop(circleId);
      },
      onError,
    }),
    create: useMutation({
      mutationFn: async (input: CircleCreate) => adopt(await circlesApi.create(input)),
      onSuccess: () => {
        feedback('success');
      },
      onError,
    }),
    /** The owner ends an event now: gone for everyone, its keys thrown away here. */
    end: useMutation({
      mutationFn: async (circleId: string) => {
        await circlesApi.end(circleId);
        circleSync.drop(circleId);
      },
      onError,
    }),
    rename: useMutation({
      mutationFn: async (input: { circleId: string; name: string }) =>
        adopt(await circlesApi.rename(input.circleId, input.name)),
      onError,
    }),
    remove: useMutation({
      mutationFn: async (input: { circleId: string; userId: string }) =>
        adopt(await circlesApi.remove(input.circleId, input.userId)),
      onError,
    }),
  };
}

/** Friend request or circle invitation by username; the caller explains a 404 in place. */
export function useInviteByUsername(circleId: string | null) {
  const onError = useFailure();
  return useMutation({
    mutationFn: async (username: string) => {
      const circle =
        circleId === null
          ? await circlesApi.requestFriend(username)
          : await circlesApi.invite(circleId, username);
      void circleSync.adopt(circle).catch(() => undefined);
      return circle;
    },
    onSuccess: () => {
      feedback('success');
    },
    onError: (error) => {
      if (!isApiError(error, 'NOT_FOUND')) onError(error);
    },
  });
}

/** The user's friends, from the cached circles (no request of its own). */
export function useFriends(): Friend[] {
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data;
  return circles === undefined ? [] : friendsOf(circles, me);
}

/**
 * Invites several friends into a group: one invitation each, every one needs its own yes. Stops at
 * a full circle or the hourly limit; returns who could not be invited.
 */
export function useInviteFriends() {
  return useMutation({
    mutationFn: async ({ circleId, friends }: { circleId: string; friends: Friend[] }) => {
      const failed: Friend[] = [];
      let latest: Circle | null = null;
      for (const [index, friend] of friends.entries()) {
        try {
          latest = await circlesApi.invite(circleId, friend.username);
        } catch (error) {
          if (isApiError(error, 'RATE_LIMITED', 'CIRCLE_FULL')) {
            failed.push(...friends.slice(index));
            break;
          }
          failed.push(friend);
        }
      }
      if (latest !== null) void circleSync.adopt(latest).catch(() => undefined);
      feedback(failed.length < friends.length ? 'success' : 'error');
      return { invited: friends.length - failed.length, failed };
    },
  });
}

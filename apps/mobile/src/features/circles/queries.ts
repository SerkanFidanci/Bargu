import type { Circle, GROUP_KINDS, MemberCard } from '@bargu/schemas';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { errorMessage, isApiError } from '../errors';
import { circleSync } from '../live/live-session';
import { circlesKey } from './circle-cache';
import { circlesApi } from './circles-api';

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

/** For a pair: the other person. For a group: undefined. */
export function partnerOf(circle: Circle, myUserId: string | null): MemberCard | undefined {
  if (circle.kind !== 'pair') return undefined;
  return circle.members.find((member) => member.userId !== myUserId);
}

/** "@username", or undefined for someone without one yet. */
export function handleOf(member: Pick<MemberCard, 'username'> | undefined): string | undefined {
  const username = member?.username ?? null;
  return username === null ? undefined : `@${username}`;
}

/** The name to show for a member: display name, else @username. */
export function memberName(member: Pick<MemberCard, 'displayName' | 'username'>): string {
  return member.displayName ?? (member.username === null ? '?' : `@${member.username}`);
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
      mutationFn: async (input: { kind: (typeof GROUP_KINDS)[number]; name: string }) =>
        adopt(await circlesApi.create(input.kind, input.name)),
      onSuccess: () => {
        feedback('success');
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

import type { Circle } from '@bargu/schemas';
import type { QueryClient } from '@tanstack/react-query';

/** All circles the user is in or invited to, as one cached list (updated from events, no refetch). */
export const circlesKey = ['circles'] as const;

export function upsertCircle(queryClient: QueryClient, circle: Circle): void {
  queryClient.setQueryData<Circle[]>(circlesKey, (current) => {
    if (current === undefined) return [circle];
    const index = current.findIndex((existing) => existing.id === circle.id);
    if (index === -1) return [...current, circle];
    return current.map((existing) => (existing.id === circle.id ? circle : existing));
  });
}

export function removeCircle(queryClient: QueryClient, circleId: string): void {
  queryClient.setQueryData<Circle[]>(circlesKey, (current) =>
    current?.filter((circle) => circle.id !== circleId),
  );
}

export function cachedCircle(queryClient: QueryClient, circleId: string): Circle | undefined {
  return queryClient.getQueryData<Circle[]>(circlesKey)?.find((circle) => circle.id === circleId);
}

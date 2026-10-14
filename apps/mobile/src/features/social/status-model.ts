import { statusPayloadSchema } from '@bargu/schemas';
import { z } from 'zod';

/** A member's status (emoji and/or short text) as received in one circle. */
export const receivedStatusSchema = z
  .object({ circleId: z.string(), userId: z.string(), status: statusPayloadSchema })
  .strict();
export type ReceivedStatus = z.infer<typeof receivedStatusSchema>;
export type Status = ReceivedStatus['status'];

/** A person's current status: the newest one over the circles shared with them. */
export function statusOf(
  statuses: Readonly<Record<string, ReceivedStatus>>,
  userId: string,
  now: number,
): Status | null {
  let best: Status | null = null;
  for (const entry of Object.values(statuses)) {
    if (entry.userId !== userId || entry.status.expiresAt <= now) continue;
    if (best === null || entry.status.ts > best.ts) best = entry.status;
  }
  return best;
}

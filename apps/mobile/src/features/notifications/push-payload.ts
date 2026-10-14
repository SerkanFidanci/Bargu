import { z } from 'zod';

const payloadSchema = z.object({ bargu: z.string().max(4_096) });

/** The sealed box in a push's data (FCM data-only message, docs/ADR/0016), if it has one. */
export function sealedOf(data: unknown): string | null {
  const candidates: unknown[] = [data];
  if (typeof data === 'object' && data !== null && 'data' in data) candidates.push(data.data);
  for (const candidate of candidates) {
    const parsed = payloadSchema.safeParse(candidate);
    if (parsed.success) return parsed.data.bargu;
  }
  return null;
}

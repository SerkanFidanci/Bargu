import { z } from 'zod';

import type { KeyValueStore } from '../storage/vault';

/**
 * Who this user blocked (docs/ADR/0035 §6), as the vault keeps it: what they send is never shown,
 * neither in the open app nor as a notification while it is closed (QA-38 O1).
 */
export const BLOCKED_KEY = 'messages:blocked:v1';
const blockedSchema = z.array(z.uuid());

export function loadBlocked(store: KeyValueStore): string[] {
  const raw = store.get(BLOCKED_KEY);
  if (raw === undefined) return [];
  try {
    const parsed = blockedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveBlocked(store: KeyValueStore, blocked: readonly string[]): void {
  store.set(BLOCKED_KEY, JSON.stringify(blocked));
}

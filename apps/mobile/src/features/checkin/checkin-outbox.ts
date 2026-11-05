/** Loads the outbox only when a check-in line is sent, keeping photo tools out of location startup. */
export function loadCheckinOutbox(): Promise<typeof import('../messages/outbox')> {
  return import('../messages/outbox');
}

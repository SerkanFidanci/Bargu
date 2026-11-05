export interface CheckinOkEvent {
  ownerId: string;
  checkinId: string;
}

const listeners = new Set<(event: CheckinOkEvent) => void>();

/** A verified check-in line crossed the message model without importing its session (no cycle). */
export function announceCheckinOk(event: CheckinOkEvent): void {
  for (const listener of listeners) listener(event);
}

export function onCheckinOk(listener: (event: CheckinOkEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

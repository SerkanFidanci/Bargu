import { Injectable, Logger } from '@nestjs/common';

export interface DeviceChange {
  userId: string;
  /** `login`: a new device became the account's active one; `logout`: the device ended. */
  kind: 'login' | 'logout';
  deviceId: string;
  /** For a login that replaced another active device. */
  replacedDeviceId: string | null;
}

type Listener = (change: DeviceChange) => Promise<void>;

/**
 * Tells other modules that an account's device changed, after the change is committed (circles
 * start a new key epoch, live connections of the old device close). Listener failures are logged,
 * never undo a login or logout.
 */
@Injectable()
export class DeviceLifecycle {
  private readonly logger = new Logger('DeviceLifecycle');
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }

  async notify(change: DeviceChange): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(change);
      } catch (error) {
        this.logger.warn(
          `device ${change.kind} follow-up failed: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
    }
  }
}

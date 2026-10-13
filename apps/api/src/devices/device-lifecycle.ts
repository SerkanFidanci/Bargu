import { Injectable, Logger } from '@nestjs/common';

export interface DeviceChange {
  userId: string;
  /**
   * `login`: a device signed in; `logout`: the user signed out on it; `revoked`: its session was
   * ended for safety (a refresh token was used twice, a sign of theft).
   */
  kind: 'login' | 'logout' | 'revoked';
  deviceId: string;
  /** For a login: the device (and its keys) is new to the account, not a re-login of the same one. */
  newDevice: boolean;
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

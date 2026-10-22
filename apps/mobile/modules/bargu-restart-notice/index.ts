import { requireOptionalNativeModule } from 'expo';

/**
 * The restart notice (docs/ADR/0028 addendum "yeniden başlatmadan sonra bildirim"). The location
 * service does not come back by itself after the phone restarts or the app updates, and JavaScript
 * cannot run at that moment, so a small native receiver posts one "Paylaşım durdu" notification.
 * The native side stores the flag and the two texts below, nothing else.
 */
export interface RestartNoticeModule {
  /**
   * Sharing is on: if the phone restarts or the app is updated, show this notice. The texts are
   * in the user's language. Also takes back a notice that is still showing.
   */
  arm(title: string, body: string): void;
  /** Sharing was ended on purpose: no notice after a restart. Also takes back a showing one. */
  disarm(): void;
}

/**
 * `null` where the native code is not in the binary: iOS (no such restriction there), Jest, an old
 * build.
 */
export default requireOptionalNativeModule<RestartNoticeModule>('BarguRestartNotice');

import restartNotice from '../../../modules/bargu-restart-notice';

/**
 * "Paylaşım durdu, Bargu'yu aç" after a phone restart or an app update (docs/ADR/0028 addendum
 * 2026-10-22). On Android the location service does not come back by itself then, and JavaScript
 * cannot run at that moment, so a native receiver (modules/bargu-restart-notice) posts the notice
 * if this flag is set. The flag is set when the app starts the location service on purpose and
 * cleared when it stops it on purpose (tracker.ts, the one place that does both). The title and
 * body travel with the flag, in the user's language. Nothing else is handed over: no position, no
 * id, no token. A no-op where there is no native module (iOS, Jest, an old build).
 */
export interface RestartText {
  title: string;
  body: string;
}

/** What the native side holds: unknown (this process has not told it), nothing, or these texts. */
let held: RestartText | null | undefined;

/** Sharing is on: show this after a restart. Told once per text; a notice still showing goes. */
export function armRestartNotice(text: RestartText): void {
  if (restartNotice === null) return;
  if (held?.title === text.title && held.body === text.body) return;
  try {
    restartNotice.arm(text.title, text.body);
    held = { ...text };
  } catch {
    // The notice is a courtesy: sharing goes on, and the next start tries again.
  }
}

/** Sharing was ended on purpose: show nothing after a restart. */
export function disarmRestartNotice(): void {
  if (restartNotice === null || held === null) return;
  try {
    restartNotice.disarm();
    held = null;
  } catch {
    // Tried again at the next stop.
  }
}

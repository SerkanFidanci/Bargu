import { openPush } from '@bargu/crypto';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { z } from 'zod';

import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { ensureSession } from '../live/live-session';
import { backgroundLive } from '../location/background-live/slot';
import { loadSharing, seenThere } from '../location/sharing';
import { admitSafe, rememberSafe, SAFE_FRESH_MS, safeAge, safeFoldedWords } from '../social/safe';
import { keepSpot, showSpot } from '../social/safe-spot';
import { vault } from '../storage/vault';
import { SAFE_QUIET_CHANNEL } from './channels';
import { isMuted, loadMutes } from './mutes';
import { identityOf, loadContacts } from './push-contacts';
import { sealedOf } from './push-payload';
import { pushText } from './push-text';

export { sealedOf };

/** expo-notifications runs this for every data message, also when the app is not open. */
export const PUSH_TASK = 'bargu-push';
/** A notification older than this when it arrives (the phone was off) is not shown any more. */
export const PUSH_FRESH_MS = 60 * 60_000;
/**
 * A `watch` signal (docs/ADR/0028 step 3) is of no use after this: someone looked a moment ago.
 * The server also has Google drop it after two minutes.
 */
export const WATCH_FRESH_MS = 2 * 60_000;
/** The last boxes opened, so a message delivered twice shows once. */
const SEEN_KEY = 'push:seen:v1';
const SEEN_KEEP = 50;

/** `watch`: the silent signal of background live mode, which is never shown. */
export type Shown =
  'shown' | 'inApp' | 'muted' | 'stale' | 'future' | 'folded' | 'duplicate' | 'refused' | 'watch';

/**
 * Opens a sealed notification on this phone and shows it in the user's words: from a member, only
 * if signed by the device the app trusts for them; nothing about it is logged. In the foreground
 * it becomes an in-app line instead of a system banner.
 */
export async function showPush(sealed: string, now = Date.now()): Promise<Shown> {
  if (!(await ensureSession())) return 'refused';
  const device = useAuth.getState().device;
  if (device === null) return 'refused';
  const store = vault();
  const contacts = loadContacts(store);
  let opened;
  try {
    opened = openPush({
      recipient: device,
      sealed,
      senderIdentityKey: (deviceId) => identityOf(contacts, deviceId),
    });
  } catch {
    return 'refused';
  }
  const watched = opened.body.kind === 'notice' && opened.body.notice === 'watch';
  // A "Güvendeyim" may have waited for its sender's connection (docs/ADR/0029): it is still news.
  const fresh = watched
    ? WATCH_FRESH_MS
    : opened.body.kind === 'safe'
      ? SAFE_FRESH_MS
      : PUSH_FRESH_MS;
  if (now - opened.body.ts > fresh) return 'stale';
  // Dated more than a few minutes ahead: a wrong clock, or made up. Not shown (docs/ADR/0029 §5).
  if (opened.body.kind === 'safe' && safeAge(opened.body.ts, now) === 'ahead') return 'future';
  // The ephemeral key at the start of the box is fresh for every box: a good "seen" mark.
  const mark = sealed.slice(0, 48);
  const seen = z
    .array(z.string())
    .catch([])
    .parse(JSON.parse(store.get(SEEN_KEY) ?? '[]'));
  if (seen.includes(mark)) return 'duplicate';
  store.set(SEEN_KEY, JSON.stringify([...seen, mark].slice(-SEEN_KEEP)));

  if (opened.body.kind === 'notice' && opened.body.notice === 'watch') {
    // Silent (docs/ADR/0028 step 3): never a banner, a line or a toast. In a build without
    // background live mode (production for now) it is dropped like any notice with no use here.
    await backgroundLive.loading?.catch(() => undefined);
    await backgroundLive.current?.notice(opened.body.circleId);
    return 'watch';
  }

  const sharing = loadSharing(store);
  const shown = pushText(
    opened.body,
    opened.senderDeviceId,
    contacts,
    (circleId) => seenThere(sharing, circleId, now),
    now,
  );
  if (shown === null) return 'refused';
  const { body } = opened;
  // The message itself may have reached the open app first (or the other way round): once.
  if (
    body.kind === 'safe' &&
    shown.fromUserId !== null &&
    !rememberSafe(store, body.circleId, shown.fromUserId, body.id)
  ) {
    return 'duplicate';
  }
  // More than six an hour from one person in one circle: one quiet line sums up the rest. The
  // route cannot be told from a push (it would be metadata Google and Apple see), so this is the
  // limit on a poke sent as a "Güvendeyim" too (QA-32 F-1).
  if (body.kind === 'safe' && shown.fromUserId !== null) {
    const admission = admitSafe(store, body.circleId, shown.fromUserId, now);
    if (!admission.show) {
      const summary = safeFoldedWords({ name: shown.fromName ?? '', count: admission.folded });
      if (AppState.currentState === 'active') {
        // A plain line, once: no haptic, no sound.
        if (admission.folded === 1) toast.info(summary);
        return 'folded';
      }
      // One notification for the person and circle, renewed as more come, on a channel without
      // sound or vibration: neither the first nor an update makes a noise.
      await Notifications.scheduleNotificationAsync({
        identifier: `safe-folded:${body.circleId}:${shown.fromUserId}`,
        content: {
          title: shown.title,
          body: summary,
          data: { circleId: body.circleId },
          sound: false,
        },
        trigger: { channelId: SAFE_QUIET_CHANNEL },
      });
      return 'folded';
    }
  }
  // Where they are, if the notification carries it: kept on this phone for a day (the vault is
  // encrypted), and nowhere else. Tapping the notification, or the line in the open app, shows it.
  const spot = shown.spot;
  if (spot !== undefined) keepSpot(store, spot, now);
  if (
    shown.fromUserId !== null &&
    // Never muted: a person's "I'm safe" is not a poke, and a safety message is not to be missed.
    body.kind !== 'notice' &&
    body.kind !== 'safe' &&
    isMuted(
      loadMutes(store),
      body.kind === 'place'
        ? { kind: 'place', placeId: body.placeId }
        : // A meeting's notices are muted with its "will be late" ones.
          { kind: body.kind === 'late' || body.kind === 'meeting' ? 'late' : 'bump' },
      shown.fromUserId,
    )
  ) {
    return 'muted';
  }
  if (AppState.currentState === 'active') {
    if (spot !== undefined) {
      toast.notice(shown.body, 'success', () => {
        showSpot(spot);
      });
    } else {
      toast.info(body.kind === 'place' ? `${shown.title} · ${shown.body}` : shown.body);
    }
    return 'inApp';
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: shown.title,
      body: shown.body,
      // The data names the message, never the place: that stays in the vault, not in the
      // system's notification store.
      data:
        shown.route !== undefined
          ? { route: shown.route }
          : spot === undefined
            ? { circleId: shown.circleId }
            : { circleId: shown.circleId, safe: spot.id },
    },
    trigger: { channelId: shown.channel },
  });
  return 'shown';
}

// Defined when the bundle loads (index.ts): Android may start the app without a screen for it.
TaskManager.defineTask(PUSH_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const sealed = sealedOf(data);
  if (sealed === null) return;
  try {
    await showPush(sealed);
  } catch {
    // Nothing about a notification is logged; the next one is tried afresh.
  }
});

/** Asks expo-notifications to run the task for data messages (Android; once per install). */
export async function registerPushTask(): Promise<void> {
  if (!(await TaskManager.isTaskRegisteredAsync(PUSH_TASK))) {
    await Notifications.registerTaskAsync(PUSH_TASK);
  }
}

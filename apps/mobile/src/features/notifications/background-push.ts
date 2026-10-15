import { openPush } from '@bargu/crypto';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { z } from 'zod';

import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { ensureSession } from '../live/live-session';
import { vault } from '../storage/vault';
import { isMuted, loadMutes } from './mutes';
import { identityOf, loadContacts } from './push-contacts';
import { sealedOf } from './push-payload';
import { pushText } from './push-text';

export { sealedOf };

/** expo-notifications runs this for every data message, also when the app is not open. */
export const PUSH_TASK = 'bargu-push';
/** A notification older than this when it arrives (the phone was off) is not shown any more. */
export const PUSH_FRESH_MS = 60 * 60_000;
/** The last boxes opened, so a message delivered twice shows once. */
const SEEN_KEY = 'push:seen:v1';
const SEEN_KEEP = 50;

export type Shown = 'shown' | 'inApp' | 'muted' | 'stale' | 'duplicate' | 'refused';

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
  if (now - opened.body.ts > PUSH_FRESH_MS) return 'stale';
  // The ephemeral key at the start of the box is fresh for every box: a good "seen" mark.
  const mark = sealed.slice(0, 48);
  const seen = z
    .array(z.string())
    .catch([])
    .parse(JSON.parse(store.get(SEEN_KEY) ?? '[]'));
  if (seen.includes(mark)) return 'duplicate';
  store.set(SEEN_KEY, JSON.stringify([...seen, mark].slice(-SEEN_KEEP)));

  const shown = pushText(opened.body, opened.senderDeviceId, contacts);
  if (shown === null) return 'refused';
  const { body } = opened;
  if (
    shown.fromUserId !== null &&
    body.kind !== 'notice' &&
    isMuted(
      loadMutes(store),
      body.kind === 'place'
        ? { kind: 'place', placeId: body.placeId }
        : { kind: body.kind === 'late' ? 'late' : 'bump' },
      shown.fromUserId,
    )
  ) {
    return 'muted';
  }
  if (AppState.currentState === 'active') {
    toast.info(body.kind === 'place' ? `${shown.title} · ${shown.body}` : shown.body);
    return 'inApp';
  }
  await Notifications.scheduleNotificationAsync({
    content: { title: shown.title, body: shown.body, data: { circleId: shown.circleId } },
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

import { MapPin } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { space } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Button } from '@/ui/button';
import { SettingsGroup } from '@/ui/settings-row';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { Toggle } from '@/ui/toggle';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { memberName } from '../circles/names';
import { useCircles } from '../circles/queries';
import { useNow } from '../location/clock';
import { useSharing } from '../location/sharing';
import { useMessages } from './messages';
import { memberIn } from './names';
import { nearTargets } from './near';
import { sendNear } from './outbox';

/**
 * "Yakındayım" (docs/ADR/0037 §6): where to say it, then one tap. One place ready is ticked; more
 * are left for the user to choose (none is ticked for them). A place told a moment ago says when it
 * can be told again; a ghost or a phone sharing with nobody is told why nothing can go.
 */
function NearChoice({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const sharing = useSharing();
  const items = useMessages((state) => state.items);
  const now = useNow();
  const targets = nearTargets(circles, sharing, me, items, now);
  const ready = targets.filter((target) => target.waitMs === 0);
  // Untouched, the one place ready is ticked; more are for the user to choose.
  const [picked, setPicked] = useState<string[] | null>(null);
  const ticked = picked ?? (ready.length === 1 ? ready.map((target) => target.circleId) : []);
  const [busy, setBusy] = useState(false);
  // A place that went since, or was just told, is not ticked any more.
  const chosen = ready.filter((target) => ticked.includes(target.circleId));

  const send = async () => {
    setBusy(true);
    try {
      const results = await Promise.all(chosen.map((target) => sendNear(target.conversation)));
      const sent = chosen.filter((_, index) => results[index] === 'sent');
      if (sent.length === 0) {
        toast.error(t(results.includes('limited') ? 'near.limited' : 'near.failed'));
        return;
      }
      const people = [...new Set(sent.flatMap((target) => target.people))];
      const first = people[0] === undefined ? undefined : memberIn(circles, people[0]);
      const name = first === undefined ? '' : memberName(first);
      feedback('success');
      toast.success(
        people.length > 1
          ? t('near.sentMore', { name, count: people.length - 1 })
          : t('near.sent', { name }),
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.body}>
      <Text variant="callout" color="textMuted">
        {t('near.intro')}
      </Text>
      {sharing.ghost !== 'off' ? (
        <Text variant="body" testID="near-ghost">
          {t('near.ghost')}
        </Text>
      ) : targets.length === 0 ? (
        <Text variant="body" testID="near-none">
          {t('near.none')}
        </Text>
      ) : (
        <SettingsGroup>
          {targets.map((target) => (
            <Toggle
              key={target.circleId}
              testID={`near-circle-${target.circleId}`}
              label={target.title}
              {...(target.waitMs === 0
                ? {}
                : {
                    description: t('near.wait', {
                      minutes: Math.max(1, Math.ceil(target.waitMs / 60_000)),
                    }),
                  })}
              disabled={target.waitMs > 0}
              value={target.waitMs === 0 && ticked.includes(target.circleId)}
              onChange={(on) => {
                const others = ticked.filter((id) => id !== target.circleId);
                setPicked(on ? [...others, target.circleId] : others);
              }}
            />
          ))}
        </SettingsGroup>
      )}
      <Button
        testID="near-send"
        label={chosen.length > 0 ? t('near.sendCount', { count: chosen.length }) : t('near.send')}
        icon={MapPin}
        onPress={() => void send()}
        loading={busy}
        disabled={chosen.length === 0}
      />
    </View>
  );
}

/** The sheet over the map, opened from the "+" (quick-sheet.tsx). */
export const NearSheet = forwardRef<SheetRef, { onClose: () => void }>(function NearSheet(
  { onClose },
  ref,
) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t('near.title')} testID="near-sheet">
      <NearChoice onClose={onClose} />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  body: { gap: space.lg },
});

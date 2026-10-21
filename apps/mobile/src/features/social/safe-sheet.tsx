import type { TFunction } from 'i18next';
import { HandHeart } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { space } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Button } from '@/ui/button';
import { SettingsGroup } from '@/ui/settings-row';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { Toggle } from '@/ui/toggle';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { useCircles } from '../circles/queries';
import { useNow } from '../location/clock';
import { useSharing } from '../location/sharing';
import { initialSelection, needsConfirm, safeRows, type SafeReport } from './safe';
import { rememberedChoice, safeCheckIns, useSafeWaiting } from './safe-session';

/** What the user is told of a tap: nothing left unsaid, in one line. */
function say(report: SafeReport, t: TFunction): boolean {
  if (report.status === 'noLocation') {
    toast.error(t('safe.noLocation'));
    return false;
  }
  if (report.status === 'nothing') {
    toast.error(t('safe.pick'));
    return false;
  }
  if (report.waiting > 0) {
    toast.info(t('safe.queued'));
    return true;
  }
  if (report.sent === 0) {
    // None went and none waits: the server took no more of them for now, or refused them.
    toast.error(t(report.limited > 0 ? 'safe.limited' : 'safe.failed'));
    return report.limited > 0;
  }
  if (report.limited > 0) {
    toast.error(t('safe.partlyLimited'));
    return true;
  }
  feedback('success');
  toast.success(t('safe.sent'));
  return true;
}

/**
 * "Güvendeyim" (docs/ADR/0029): which circles to tell, then one tap. The last choice is ticked
 * again, a circle that gets only a coarse cell says so, and a ghost (or a circle that does not see
 * the location now) is asked first, because the location goes once in this message.
 */
function SafeBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const sharing = useSharing();
  const now = useNow();
  const waiting = useSafeWaiting((state) => state.count);
  const rows = safeRows(circles, sharing, me, now);
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelection(rows, rememberedChoice()),
  );
  const [busy, setBusy] = useState(false);
  // A circle that went since (left, an event over) is not ticked any more.
  const ticked = selected.filter((id) => rows.some((row) => row.circleId === id));

  const send = async () => {
    setBusy(true);
    try {
      const report = await safeCheckIns.tell(ticked);
      if (say(report, t)) onClose();
    } catch {
      toast.error(t('safe.failed'));
    } finally {
      setBusy(false);
    }
  };
  const press = () => {
    if (!needsConfirm(rows, ticked)) {
      void send();
      return;
    }
    Alert.alert(t('safe.confirmTitle'), t('safe.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('safe.confirmSend'),
        onPress: () => {
          void send();
        },
      },
    ]);
  };

  return (
    <View style={styles.body}>
      <Text variant="callout" color="textMuted">
        {t('safe.intro')}
      </Text>
      {rows.length === 0 ? (
        <Text variant="body" testID="safe-none">
          {t('safe.none')}
        </Text>
      ) : (
        <SettingsGroup>
          {rows.map((row) => {
            const notes = [
              row.coarse ? t('safe.coarse') : null,
              row.unshared ? t('safe.unshared') : null,
            ].filter((note): note is string => note !== null);
            return (
              <Toggle
                key={row.circleId}
                testID={`safe-circle-${row.circleId}`}
                label={row.title}
                {...(notes.length === 0 ? {} : { description: notes.join(' · ') })}
                value={ticked.includes(row.circleId)}
                onChange={(on) => {
                  setSelected((current) =>
                    on
                      ? [...current.filter((id) => id !== row.circleId), row.circleId]
                      : current.filter((id) => id !== row.circleId),
                  );
                }}
              />
            );
          })}
        </SettingsGroup>
      )}
      {waiting > 0 ? (
        <Text variant="footnote" color="textMuted" testID="safe-waiting">
          {t('safe.waiting', { count: waiting })}
        </Text>
      ) : null}
      <Button
        testID="safe-send"
        label={ticked.length > 0 ? t('safe.sendCount', { count: ticked.length }) : t('safe.send')}
        icon={HandHeart}
        onPress={press}
        loading={busy}
        disabled={ticked.length === 0}
      />
    </View>
  );
}

/** The sheet over the map, opened by the map's button and by the Me sheet. */
export const SafeSheet = forwardRef<SheetRef, { onClose: () => void }>(function SafeSheet(
  { onClose },
  ref,
) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t('safe.title')} testID="safe-sheet">
      <SafeBody onClose={onClose} />
    </Sheet>
  );
});

const styles = StyleSheet.create({
  body: { gap: space.lg },
});

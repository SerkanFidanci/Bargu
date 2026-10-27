import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { Toggle } from '@/ui/toggle';

import { loadMuteSettings, updateMutes } from './mute-session';
import { personMutes, useMutes, withPersonMuted } from './mutes';

/**
 * One person's notifications (radial menu "Bildirimler"): their arrivals and departures, their
 * pokes, and their messages and stories (docs/ADR/0035 §11). Switched off only on this phone (mutes.ts).
 */
export const MuteSheet = forwardRef<SheetRef, { person: { userId: string; name: string } | null }>(
  function MuteSheet({ person }, ref) {
    const { t } = useTranslation();
    const mutes = useMutes();
    loadMuteSettings();
    const current = person === null ? null : personMutes(mutes, person.userId);
    return (
      <Sheet ref={ref} title={t('notifications.mute.title', { name: person?.name ?? '' })}>
        {person === null || current === null ? null : (
          <>
            <Toggle
              testID="mute-places"
              label={t('notifications.mute.places')}
              value={!current.places}
              onChange={(on) => {
                updateMutes((all) => withPersonMuted(all, person.userId, { places: !on }));
              }}
            />
            <Toggle
              testID="mute-pokes"
              label={t('notifications.mute.pokes')}
              value={!current.pokes}
              onChange={(on) => {
                updateMutes((all) => withPersonMuted(all, person.userId, { pokes: !on }));
              }}
            />
            <Toggle
              testID="mute-messages"
              label={t('notifications.mute.messages')}
              value={!current.messages}
              onChange={(on) => {
                updateMutes((all) => withPersonMuted(all, person.userId, { messages: !on }));
              }}
            />
            <Text variant="caption" color="textMuted">
              {t('notifications.mute.hint')}
            </Text>
          </>
        )}
      </Sheet>
    );
  },
);

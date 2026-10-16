import type { Avatar as AvatarData } from '@bargu/schemas';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/ui/avatar';
import { type MarkerDetail, markerDetailText } from '@/ui/avatar-marker';
import { ListRow } from '@/ui/list-row';
import { Sheet, type SheetRef } from '@/ui/sheet';

import type { Activity } from './activity';

/** Someone standing in a group on the map, as the list shows them. */
export interface GroupMember {
  userId: string;
  name: string;
  avatar: AvatarData | null;
  /** The user themselves (listed, not opened). */
  me: boolean;
  staleMinutes?: number | undefined;
  activity?: Activity | undefined;
  /** Their speed or how long they have stayed (motion-detail.ts). */
  detail?: MarkerDetail | undefined;
}

/**
 * Everyone standing together at one spot on the map (proje sahibi 2026-10-16: "tıklayınca oradaki
 * kişiler bir pencerede gözüksün"): the frame shows two of them, this lists them all. A tap on
 * someone opens their card.
 */
export const TogetherSheet = forwardRef<
  SheetRef,
  { people: readonly GroupMember[]; onPick: (userId: string) => void }
>(function TogetherSheet({ people, onPick }, ref) {
  const { t } = useTranslation();
  const subtitle = (person: GroupMember) => {
    if (person.staleMinutes !== undefined) {
      return person.staleMinutes >= 60
        ? t('map.together.staleHours', { hours: Math.floor(person.staleMinutes / 60) })
        : t('map.together.stale', { minutes: person.staleMinutes });
    }
    const { activity, detail } = person;
    if (detail?.kind === 'stay') return markerDetailText(detail, t, true);
    if (activity !== undefined && activity !== 'still') {
      const doing = t(`ui.marker.activity.${activity}`);
      return detail === undefined ? doing : `${doing} · ${markerDetailText(detail, t)}`;
    }
    return t('map.together.live');
  };
  return (
    <Sheet ref={ref} title={t('map.together.title', { count: people.length })}>
      {people.map((person) => (
        <ListRow
          key={person.userId}
          testID={`together-${person.userId}`}
          leading={
            <Avatar
              avatar={person.avatar}
              name={person.name}
              size="md"
              userId={person.userId}
              muted={person.staleMinutes !== undefined}
            />
          }
          title={person.me ? t('map.together.me') : person.name}
          subtitle={subtitle(person)}
          onPress={
            person.me
              ? undefined
              : () => {
                  onPick(person.userId);
                }
          }
        />
      ))}
    </Sheet>
  );
});

import { router } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { docKey, useDocs } from '@/features/plan/docs';
import { Avatar } from '@/ui/avatar';
import { EmptyState } from '@/ui/empty-state';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';

/**
 * "Buluşma başlat" from the map's + (the project owner's request, docs/ADR/0026): which circle the
 * meeting is in. Events have their own meeting; a circle that has one shows it instead.
 */
export default function NewMeetingScreen() {
  const { t } = useTranslation();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const docs = useDocs();
  const candidates = circles.filter(
    (circle) =>
      circle.kind !== 'event' &&
      circle.myStatus === 'active' &&
      circle.members.some((member) => member.userId !== me && member.status === 'active'),
  );

  return (
    <Screen title={t('meeting.startTitle')} subtitle={t('meeting.chooseCircle')}>
      {candidates.length === 0 ? (
        <EmptyState icon={Users} title={t('meeting.noCircles')} body={t('meeting.noCirclesBody')} />
      ) : (
        candidates.map((circle) => {
          const friend =
            circle.kind === 'pair'
              ? circle.members.find((member) => member.userId !== me)
              : undefined;
          const name = friend === undefined ? (circle.name ?? '') : memberName(friend);
          const has = docs[docKey(circle.id, circle.id)]?.payload.kind === 'plan';
          return (
            <ListRow
              key={circle.id}
              testID={`meeting-circle-${circle.id}`}
              leading={
                friend === undefined ? (
                  <Users size={22} />
                ) : (
                  <Avatar avatar={friend.avatar} name={name} userId={friend.userId} size="sm" />
                )
              }
              title={name}
              subtitle={has ? t('meeting.hasOne') : undefined}
              onPress={() => {
                router.replace({
                  pathname: '/meeting/[circleId]',
                  params: { circleId: circle.id },
                });
              }}
            />
          );
        })
      )}
    </Screen>
  );
}

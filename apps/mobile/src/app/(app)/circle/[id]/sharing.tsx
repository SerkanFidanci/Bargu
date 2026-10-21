import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/auth-store';
import { memberName, partnerOf } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { SharingCard } from '@/features/location/sharing-card';
import { Screen } from '@/ui/screen';

/**
 * What one circle gets of the user's location (from the circle's screen, the owner: each setting
 * on its own screen): on or off, how precise, for how long, and the history.
 */
export default function CircleSharingScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useAuth((state) => state.userId);
  const circle = useCircles().data?.find((candidate) => candidate.id === id);
  const partner = circle?.kind === 'pair' ? partnerOf(circle, me) : undefined;
  const name = partner === undefined ? null : memberName(partner);
  return (
    <Screen title={t('location.sharing.title')} testID="circle-sharing-screen">
      <SharingCard circleId={id} name={name} />
    </Screen>
  );
}

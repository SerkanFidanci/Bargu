import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PlacesCard } from '@/features/places/places-card';
import { Screen } from '@/ui/screen';

/** One circle's places (from the circle's screen, the owner: each part on its own screen). */
export default function CirclePlacesScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen title={t('places.title')} testID="circle-places-screen">
      <PlacesCard circleId={id} />
    </Screen>
  );
}

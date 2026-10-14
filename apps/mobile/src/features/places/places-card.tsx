import { MAX_PLACES_PER_CIRCLE } from '@bargu/schemas';
import { router } from 'expo-router';
import { MapPin, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';

import { useNow } from '../location/clock';
import { useSharing } from '../location/sharing';
import { announcesTo } from './presence';
import { usePlaces } from './places';

/**
 * A circle's places on its screen (BARGU_PLAN §4.3 "Yerler"): each with its icon, name and size,
 * a tap to edit it, and "add a place". Says when this phone does not announce its own comings and
 * goings to the circle (no exact location shared).
 */
export function PlacesCard({ circleId }: { circleId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const settings = useSharing();
  const now = useNow();
  const places = Object.values(usePlaces())
    .filter((place) => place.circleId === circleId)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const open = (id?: string) => {
    router.push({
      pathname: '/place/[circleId]',
      params: id === undefined ? { circleId } : { circleId, id },
    });
  };
  return (
    <View style={styles.card}>
      <SectionTitle>{t('places.title')}</SectionTitle>
      {places.length === 0 ? (
        <Text variant="body" color="textMuted">
          {t('places.empty')}
        </Text>
      ) : (
        places.map((place) => (
          <ListRow
            key={place.id}
            testID={`place-${place.id}`}
            leading={
              <View style={[styles.icon, { backgroundColor: colors.surfaceRaised }]}>
                <Text variant="headline" allowFontScaling={false}>
                  {place.emoji}
                </Text>
              </View>
            }
            title={place.name}
            subtitle={t('places.meters', { meters: place.radius })}
            onPress={() => {
              open(place.id);
            }}
          />
        ))
      )}
      {announcesTo(settings, circleId, now) ? null : (
        <View style={styles.note}>
          <MapPin size={space.md} color={colors.textMuted} />
          <Text variant="caption" color="textMuted" style={styles.noteText}>
            {t('places.exactOnly')}
          </Text>
        </View>
      )}
      {places.length < MAX_PLACES_PER_CIRCLE ? (
        <Button
          testID="add-place"
          label={t('places.add')}
          icon={Plus}
          variant="secondary"
          onPress={() => {
            open();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  icon: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' },
  noteText: { flex: 1 },
});

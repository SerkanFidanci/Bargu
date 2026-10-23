import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { ListRow } from '@/ui/list-row';
import { SectionTitle } from '@/ui/screen';

import { endClock } from '../circles/event-ui';
import { useNow } from '../location/clock';
import { usePlaces } from '../places/places';
import { docKey, useDocs } from './docs';
import { meetingPlace } from './meeting';

/**
 * A circle's meeting on its screen, outside an event (docs/ADR/0026): "Buluşma başlat" when there
 * is none, otherwise when and where; both open the meeting's own screen.
 */
export function MeetingRow({ circle }: { circle: Pick<Circle, 'id'> }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const plan = useDocs((state) => state[docKey(circle.id, circle.id)])?.payload;
  const places = usePlaces();
  const place = plan?.kind === 'plan' ? meetingPlace(plan, places) : undefined;
  const meeting = plan?.kind === 'plan' ? plan : undefined;
  const open = () => {
    router.push({ pathname: '/meeting/[circleId]', params: { circleId: circle.id } });
  };
  return (
    <View style={styles.section}>
      <SectionTitle>{t('meeting.title')}</SectionTitle>
      <ListRow
        testID="circle-meeting"
        leading={
          <View style={[styles.flag, { backgroundColor: colors.accent }]}>
            <Flag size={18} color={colors.onAccent} strokeWidth={2.5} />
          </View>
        }
        title={
          meeting === undefined
            ? t('meeting.start')
            : `${place === undefined ? '' : `${place.emoji} ${place.name} · `}${
                meeting.meetAt === undefined
                  ? t('plan.noTime')
                  : endClock(meeting.meetAt, now, i18n.language)
              }`
        }
        subtitle={meeting === undefined ? t('meeting.startHint') : t('meeting.openHint')}
        onPress={open}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.xs },
  flag: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

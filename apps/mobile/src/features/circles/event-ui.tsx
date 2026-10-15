import type { Circle } from '@bargu/schemas';
import { CalendarClock } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import type { TFunction } from 'i18next';

import { useTheme } from '@/theme';
import { CountdownRing } from '@/ui/countdown-ring';

import { timeLeft } from './event-time';

/** "2 sa 14 dk kaldı" / "14 dk kaldı". */
export function timeLeftText(t: TFunction, expiresAt: number, now: number): string {
  const { hours, minutes } = timeLeft(expiresAt, now);
  return hours === 0
    ? t('circles.event.leftMinutes', { minutes })
    : t('circles.event.left', { hours, minutes });
}

/** When an event ends, as people say it: "22:00" today, else with the day ("Cmt 22:00"). */
export function endClock(expiresAt: number, now: number, language: string): string {
  const end = new Date(expiresAt);
  const sameDay = end.toDateString() === new Date(now).toDateString();
  return end.toLocaleString(
    language,
    sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', hour: '2-digit', minute: '2-digit' },
  );
}

/** "Bitiş: 22:00". */
export function endText(t: TFunction, expiresAt: number, now: number, language: string): string {
  return t('circles.event.endsAt', { time: endClock(expiresAt, now, language) });
}

/** An event circle's icon inside its countdown ring (lists and the circle screen). */
export function EventBadge({
  circle,
  now,
  size,
}: {
  circle: Pick<Circle, 'startedAt' | 'expiresAt'>;
  now: number;
  size: number;
}) {
  const { colors } = useTheme();
  const stroke = Math.max(3, Math.round(size / 14));
  const inner = size - stroke * 4;
  const icon = (
    <View
      style={[
        styles.icon,
        {
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: colors.primarySoft,
        },
      ]}
    >
      <CalendarClock color={colors.primary} size={Math.round(inner / 2)} strokeWidth={2.25} />
    </View>
  );
  if (circle.expiresAt === undefined) return icon;
  return (
    <CountdownRing
      startedAt={circle.startedAt ?? now}
      expiresAt={circle.expiresAt}
      now={now}
      size={size}
      stroke={stroke}
    >
      {icon}
    </CountdownRing>
  );
}

const styles = StyleSheet.create({ icon: { alignItems: 'center', justifyContent: 'center' } });

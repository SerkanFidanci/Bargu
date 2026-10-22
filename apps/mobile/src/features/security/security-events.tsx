import type { SecurityEvent } from '@bargu/schemas';
import { useQuery } from '@tanstack/react-query';
import {
  Globe,
  KeyRound,
  LogOut,
  type LucideIcon,
  Mail,
  ShieldAlert,
  Smartphone,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { ListRow } from '@/ui/list-row';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';

import { fetchSecurityEvents, securityEventsKey } from './security-api';

const ICONS: Record<SecurityEvent['type'], LucideIcon> = {
  login_otp: Mail,
  login_passkey: KeyRound,
  device_replaced: Smartphone,
  refresh_reuse: ShieldAlert,
  passkey_added: KeyRound,
  logout: LogOut,
  device_revoked_remote: Globe,
};

/** Events that need the user's attention: told in the danger colour. */
const ALARMING: ReadonlySet<SecurityEvent['type']> = new Set([
  'refresh_reuse',
  'device_revoked_remote',
]);

/**
 * The account's security events (Faz 9, "güvenlik olayları"): what happened, when, and on this
 * phone or another. Read when the screen opens; nothing about where (the server keeps no IP).
 */
export function SecurityEvents() {
  const { t } = useTranslation();
  const events = useQuery({ queryKey: securityEventsKey, queryFn: fetchSecurityEvents });
  if (events.data === undefined) {
    return events.isError ? (
      <Text variant="footnote" color="textMuted">
        {t('security.eventsFailed')}
      </Text>
    ) : (
      <Skeleton width="100%" height={space.xxxl} />
    );
  }
  if (events.data.length === 0) {
    return (
      <Text variant="footnote" color="textMuted">
        {t('security.eventsEmpty')}
      </Text>
    );
  }
  return (
    <View testID="security-events">
      {events.data.map((event) => (
        <SecurityEventRow key={event.id} event={event} />
      ))}
    </View>
  );
}

function SecurityEventRow({ event }: { event: SecurityEvent }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const Icon = ICONS[event.type];
  const alarming = ALARMING.has(event.type);
  const when = new Date(event.at).toLocaleString(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const device =
    event.device === null
      ? null
      : event.device.current
        ? t('security.thisPhone')
        : t(`security.otherPhone_${event.device.platform}`);
  return (
    <ListRow
      testID={`security-event-${event.id}`}
      leading={
        <View
          style={[styles.icon, { backgroundColor: alarming ? colors.danger : colors.primarySoft }]}
        >
          <Icon color={alarming ? colors.onDanger : colors.primary} size={18} strokeWidth={2.25} />
        </View>
      }
      title={t(`security.event_${event.type}`)}
      subtitle={[when, device].filter((part) => part !== null).join(' · ')}
    />
  );
}

const styles = StyleSheet.create({
  icon: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

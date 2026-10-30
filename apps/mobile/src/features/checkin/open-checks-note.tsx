import { router } from 'expo-router';
import { House } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { ListRow } from '@/ui/list-row';

import { nameOf, useOwnChecks } from './checkin-session';

/**
 * Open arrival checks, where who sees the user is listed (docs/ADR/0039 §10, coercion): if an alert
 * goes, these people see the last location. No check is hidden; one tap leads to ending it.
 */
export function OpenChecksNote() {
  const { t } = useTranslation();
  const all = useOwnChecks((state) => state.checks);
  const checks = all.filter((check) => check.state === 'armed');
  const plans = useOwnChecks((state) => state.plans);
  const people = [...new Set([...checks, ...plans].flatMap((each) => each.recipients))];
  if (people.length === 0) return null;
  return (
    <ListRow
      testID="seers-checkins"
      leading={<House size={22} strokeWidth={2.25} />}
      title={t('checkin.title')}
      subtitle={t('checkin.ghostNote')}
      accessibilityLabel={`${t('checkin.title')}: ${people.map(nameOf).join(', ')}`}
      onPress={() => {
        router.push('/checkin');
      }}
    />
  );
}

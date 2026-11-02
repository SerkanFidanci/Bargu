import { router } from 'expo-router';
import { House } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { ListRow } from '@/ui/list-row';

import { useSharing } from '../location/sharing';
import { nameOf, useOwnChecks } from './checkin-session';

/**
 * Open arrival checks, where who sees the user is listed (docs/ADR/0039 §10, coercion): if an alert
 * goes, these people see the last location, and their names are on screen, not only read aloud
 * (QA-44 Orta 1). No check is hidden; one tap leads to ending it. That the circles do not see the
 * user is said only while a ghost (QA-44 Düşük 2).
 */
export function OpenChecksNote() {
  const { t } = useTranslation();
  const all = useOwnChecks((state) => state.checks);
  const checks = all.filter((check) => check.state === 'armed');
  const plans = useOwnChecks((state) => state.plans);
  const ghost = useSharing((state) => state.ghost !== 'off');
  const people = [...new Set([...checks, ...plans].flatMap((each) => each.recipients))];
  if (people.length === 0) return null;
  const seers = t('checkin.seers', { names: people.map(nameOf).join(', ') });
  return (
    <ListRow
      testID="seers-checkins"
      leading={<House size={22} strokeWidth={2.25} />}
      title={t('checkin.title')}
      subtitle={ghost ? `${seers}\n${t('checkin.ghostNote')}` : seers}
      subtitleLines={6}
      onPress={() => {
        router.push('/checkin');
      }}
    />
  );
}

import { useTranslation } from 'react-i18next';

import { Pill } from '@/ui/pill';
import { Text } from '@/ui/text';

import { useCardsWaiting } from './map-cards';

/**
 * "+N" under the card on the map (the PM report T4, 2026-10-29): one card at a time keeps the map
 * big, and this says more wait; each shows when the one in front is closed.
 */
export function CardsWaiting() {
  const { t } = useTranslation();
  const waiting = useCardsWaiting();
  if (waiting === 0) return null;
  return (
    <Pill testID="cards-waiting" accessibilityLabel={t('main.cardsWaiting', { count: waiting })}>
      <Text variant="footnote" color="textMuted">
        {`+${String(waiting)}`}
      </Text>
    </Pill>
  );
}

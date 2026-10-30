import type { Circle } from '@bargu/schemas';
import { Hand, UserCheck } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { feedback } from '@/theme/haptics';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { memberName } from '../circles/names';
import { useNow } from '../location/clock';
import { isOpen, notAnswered, ownersOf } from './rollcall-model';
import {
  answerRollcall,
  closeRollcall,
  type RollcallResult,
  startRollcall,
  useRollcall,
} from './rollcall-session';

const MINUTE_MS = 60_000;

/**
 * "Herkes yerinde mi?" on an event's screen (docs/ADR/0040 §5). An owner asks and sees who said
 * "Buradayım" and who has not; the others it asks see one big button. Members it leaves out see
 * nothing of it, and an owner sees only how many were left out, never why. The ten minutes count
 * down on this phone's clock; changes come from the server's message.
 */
export function RollcallCard({ circle }: { circle: Circle }) {
  const { t } = useTranslation();
  const me = useAuth((state) => state.userId);
  const now = useNow();
  const { data: rollcall } = useRollcall(circle);
  const [busy, setBusy] = useState(false);
  if (me === null || circle.kind !== 'event') return null;
  const owner = ownersOf(circle).has(me);
  const open = rollcall !== null && rollcall !== undefined && isOpen(rollcall, now);
  const asked = rollcall?.eligible.includes(me) === true;
  if (!owner && !(open && asked)) return null;

  const run = async (step: () => Promise<RollcallResult>, done?: string) => {
    setBusy(true);
    const result = await step();
    setBusy(false);
    if (result === 'ok') {
      feedback('success');
      if (done !== undefined) toast.success(done);
      return;
    }
    toast.error(
      t(
        result === 'ALREADY_OPEN' ||
          result === 'RATE_LIMITED' ||
          result === 'CLOSED' ||
          result === 'NOT_OWNER'
          ? `rollcall.refused.${result}`
          : 'rollcall.refused.failed',
      ),
    );
  };
  const nameOf = (userId: string) => {
    const member = circle.members.find((candidate) => candidate.userId === userId);
    return member === undefined ? '?' : memberName(member);
  };
  const counted =
    rollcall === null || rollcall === undefined
      ? null
      : {
          here: Object.keys(rollcall.here).length,
          all: rollcall.eligible.length,
        };

  // A member it asks: one tap, no location.
  if (!owner && rollcall !== null && rollcall !== undefined) {
    const said = rollcall.here[me] !== undefined;
    return (
      <Card
        title={t('rollcall.asking', { name: nameOf(rollcall.startedBy) })}
        testID="rollcall-card"
      >
        {said ? (
          <Text variant="body" testID="rollcall-said">
            {t('rollcall.saidHere')}
          </Text>
        ) : (
          <Button
            testID="rollcall-here"
            label={t('rollcall.here')}
            icon={Hand}
            loading={busy}
            onPress={() => void run(() => answerRollcall(circle, rollcall.id))}
          />
        )}
        <Text variant="footnote" color="textMuted">
          {t('rollcall.noLocation')}
        </Text>
      </Card>
    );
  }

  // An owner: ask, or follow the open one, or see how the last one went.
  return (
    <Card title={t('rollcall.title')} testID="rollcall-card">
      {open && counted !== null ? (
        <>
          <Text variant="headline" testID="rollcall-count">
            {t('rollcall.count', counted)} ·{' '}
            {t('rollcall.left', {
              minutes: Math.max(1, Math.ceil((rollcall.closesAt - now) / MINUTE_MS)),
            })}
          </Text>
          {notAnswered(rollcall).length === 0 ? null : (
            <Text variant="body" testID="rollcall-missing">
              {t('rollcall.notAnswered', {
                names: notAnswered(rollcall).map(nameOf).join(', '),
              })}
            </Text>
          )}
          {rollcall.outCount === 0 ? null : (
            <Text variant="footnote" color="textMuted" testID="rollcall-out">
              {t('rollcall.out', { count: rollcall.outCount })}
            </Text>
          )}
          <Button
            testID="rollcall-end"
            label={t('rollcall.end')}
            variant="secondary"
            loading={busy}
            onPress={() => void run(() => closeRollcall(circle, rollcall.id))}
          />
        </>
      ) : (
        <>
          {counted === null ? null : (
            <Text variant="body" testID="rollcall-last">
              {t('rollcall.ended', counted)}
            </Text>
          )}
          <Button
            testID="rollcall-ask"
            label={t('rollcall.ask')}
            icon={UserCheck}
            loading={busy}
            onPress={() => void run(() => startRollcall(circle))}
          />
          <Text variant="footnote" color="textMuted">
            {t('rollcall.askHint')}
          </Text>
        </>
      )}
    </Card>
  );
}

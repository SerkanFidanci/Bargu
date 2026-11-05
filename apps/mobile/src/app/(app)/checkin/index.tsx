import { router } from 'expo-router';
import { Bell, Clock, House, Plus, Repeat } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { OwnCheck } from '@/features/checkin/checkin-model';
import {
  type CheckinResult,
  extendCheck,
  imOk,
  nameOf,
  skipNext,
  stopPlan,
  useAlerts,
  useOwnChecks,
} from '@/features/checkin/checkin-session';
import { Emergency } from '@/features/checkin/emergency';
import { clockOf } from '@/features/location/person-share';
import { space } from '@/theme';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { ListRow } from '@/ui/list-row';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * "Eve vardım kontrolü" (docs/ADR/0039 §1): this phone's open checks and repeated plans, with
 * "Vardım", "15 dk uzat" and, once an alert went, "İyiyim, haber ver"; safety alerts that came to
 * this person; and "Bargu acil servis değildir" with 112 and KADES.
 */
export default function CheckinScreen() {
  const { t, i18n } = useTranslation();
  const checks = useOwnChecks((state) => state.checks);
  const plans = useOwnChecks((state) => state.plans);
  const alerts = useAlerts(
    (state) => state.alerts.length + state.unreadable.length + state.resolved.length,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const open = checks.filter((check) => check.state !== 'done');

  const run = async (id: string, step: () => Promise<CheckinResult>, done: string) => {
    setBusy(id);
    const result = await step();
    setBusy(null);
    if (result === 'ok') toast.success(done);
    else if (result === 'EXTENDS') toast.error(t('checkin.refused.EXTENDS'));
    else toast.error(t('checkin.refused.failed'));
  };
  const names = (ids: readonly string[]) => ids.map(nameOf).join(', ');
  const placeOf = (check: Pick<OwnCheck, 'place'>) =>
    check.place === null ? t('checkin.title') : `${check.place.emoji} ${check.place.name}`;

  return (
    <Screen
      title={t('checkin.title')}
      testID="checkin-screen"
      footer={
        <Button
          testID="checkin-new"
          label={t('checkin.start')}
          icon={Plus}
          onPress={() => {
            router.push('/checkin/new');
          }}
        />
      }
    >
      <Text variant="callout" color="textMuted">
        {t('checkin.intro')}
      </Text>
      {alerts === 0 ? null : (
        <ListRow
          testID="checkin-alerts"
          leading={<Bell size={22} strokeWidth={2.25} />}
          title={t('checkin.alert.title')}
          subtitle={String(alerts)}
          onPress={() => {
            router.push('/checkin/alerts');
          }}
        />
      )}
      <Card title={t('checkin.active')} testID="checkin-active">
        {open.length === 0 && plans.length === 0 ? (
          <Text variant="body" color="textMuted">
            {t('checkin.noneActive')}
          </Text>
        ) : null}
        {open.map((check) => (
          <View key={check.id} style={styles.check} testID={`checkin-${check.id}`}>
            <ListRow
              leading={
                check.state === 'fired' ? (
                  <Bell size={22} strokeWidth={2.25} />
                ) : (
                  <House size={22} strokeWidth={2.25} />
                )
              }
              title={placeOf(check)}
              subtitle={
                check.state === 'fired'
                  ? t('checkin.firedLine', { names: names(check.recipients) })
                  : t('checkin.activeLine', {
                      place: placeOf(check),
                      time: clockOf(check.due, i18n.language),
                      names: names(check.recipients),
                    })
              }
            />
            <View style={styles.buttons}>
              <View style={styles.cell}>
                <Button
                  testID={`checkin-ok-${check.id}`}
                  label={check.state === 'fired' ? t('checkin.firedOk') : t('checkin.arrived')}
                  loading={busy === check.id}
                  onPress={() =>
                    void run(
                      check.id,
                      () => imOk(check.id),
                      check.state === 'fired' ? t('checkin.okLateToast') : t('checkin.okToast'),
                    )
                  }
                />
              </View>
              {check.state === 'armed' ? (
                <View style={styles.cell}>
                  <Button
                    testID={`checkin-extend-${check.id}`}
                    label={t('checkin.extend')}
                    icon={Clock}
                    variant="secondary"
                    loading={busy === check.id}
                    onPress={() =>
                      void run(check.id, () => extendCheck(check.id), t('checkin.extended'))
                    }
                  />
                </View>
              ) : null}
            </View>
          </View>
        ))}
        {plans.map((plan) => (
          <View key={plan.id} style={styles.check} testID={`checkin-plan-${plan.id}`}>
            <ListRow
              leading={<Repeat size={22} strokeWidth={2.25} />}
              title={placeOf(plan)}
              subtitle={t('checkin.activeLinePlan', {
                place: placeOf(plan),
                time: plan.at,
                names: names(plan.recipients),
              })}
            />
            <View style={styles.buttons}>
              <View style={styles.cell}>
                <Button
                  testID={`checkin-skip-${plan.id}`}
                  label={t('checkin.skipToday')}
                  variant="secondary"
                  onPress={() => void skipNext(plan.id)}
                />
              </View>
              <View style={styles.cell}>
                <Button
                  testID={`checkin-stop-${plan.id}`}
                  label={t('checkin.stopPlan')}
                  variant="secondary"
                  onPress={() => {
                    stopPlan(plan.id);
                  }}
                />
              </View>
            </View>
          </View>
        ))}
        {plans.length === 0 ? null : (
          <Text variant="footnote" color="textMuted">
            {t('checkin.needsPhone')}
          </Text>
        )}
      </Card>
      <Emergency />
    </Screen>
  );
}

const styles = StyleSheet.create({
  check: { gap: space.sm },
  buttons: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
});

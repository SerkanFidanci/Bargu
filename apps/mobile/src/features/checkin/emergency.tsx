import { Phone, ShieldAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { space } from '@/theme';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Text } from '@/ui/text';

/** KADES, found in the store (its listing opens the app when it is there; no package id guessed). */
const KADES_URL = 'https://play.google.com/store/search?q=KADES&c=apps';

/**
 * "Bargu acil servis değildir" with 112 and KADES one tap away (docs/ADR/0039 §1, §10): the server
 * may never hand an alert over, so a check is no emergency service, and the screen says so.
 */
export function Emergency() {
  const { t } = useTranslation();
  return (
    <Card testID="checkin-emergency">
      <Text variant="body">{t('checkin.notEmergency')}</Text>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Button
            testID="checkin-112"
            label={t('checkin.call112')}
            icon={Phone}
            onPress={() => void Linking.openURL('tel:112').catch(() => undefined)}
          />
        </View>
        <View style={styles.cell}>
          <Button
            testID="checkin-kades"
            label={t('checkin.kades')}
            icon={ShieldAlert}
            variant="secondary"
            onPress={() => void Linking.openURL(KADES_URL).catch(() => undefined)}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
});

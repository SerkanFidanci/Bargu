import { codePointsOf } from '@bargu/schemas';
import { Mail } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openReport, REPORT_MAX, reportMail, SUPPORT_EMAIL } from '@/features/help/report';
import { Button } from '@/ui/button';
import { Hint } from '@/ui/hint';
import { Screen, SectionTitle } from '@/ui/screen';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';

/**
 * "Yardım" (from Me), with "Sorun bildir" (the PM report Ö1, 2026-10-29: in the closed test, the one
 * way back for what testers find): a few words, then the phone's e-mail app opens with them, the
 * app's version and the phone's model, addressed to support. A screenshot can be added there. The
 * user sends it; no location, message or name goes with it, and Bargu's server sees none of it.
 */
export default function HelpScreen() {
  const { t } = useTranslation();
  const [words, setWords] = useState('');
  const send = async () => {
    const opened = await openReport(
      reportMail(words, {
        subject: t('help.report.subject'),
        version: t('help.report.version'),
        phone: t('help.report.phone'),
      }),
    );
    if (!opened) toast.error(t('help.report.noMail', { address: SUPPORT_EMAIL }));
  };
  return (
    <Screen
      title={t('help.title')}
      testID="help-screen"
      footer={
        <Button
          testID="report-send"
          label={t('help.report.send')}
          icon={Mail}
          disabled={words.trim().length === 0}
          onPress={() => void send()}
        />
      }
    >
      <SectionTitle>{t('help.report.title')}</SectionTitle>
      <TextField
        testID="report-words"
        label={t('help.report.label')}
        placeholder={t('help.report.placeholder')}
        value={words}
        onChangeText={(next) => {
          if (codePointsOf(next) <= REPORT_MAX) setWords(next);
        }}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />
      <Hint>{t('help.report.includes')}</Hint>
      <Hint>{t('help.report.screenshot')}</Hint>
    </Screen>
  );
}

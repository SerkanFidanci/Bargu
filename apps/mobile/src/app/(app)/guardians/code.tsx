import { useQuery } from '@tanstack/react-query';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { router } from 'expo-router';
import { RefreshCw, Share2 } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';

import { errorMessage } from '@/features/errors';
import { guardiansApi, guardiansKey } from '@/features/guardians/guardians-api';
import { space } from '@/theme';
import { Button } from '@/ui/button';
import { QrCode } from '@/ui/qr-code';
import { Screen } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

const MAX_QR = 280;

/**
 * The child's code (docs/ADR/0023 §4): shown to the parent in person, ten minutes, once. When the
 * parent takes it, the child says the last yes on the list.
 */
export default function GuardianCodeScreen() {
  usePreventScreenCapture();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const code = useQuery({
    queryKey: ['guardian-code'],
    queryFn: () => guardiansApi.code(),
    gcTime: 0,
    retry: false,
  });
  const links = useQuery({ queryKey: guardiansKey, queryFn: () => guardiansApi.list() });

  // The parent took it (an event refetched the links): on to the last yes.
  const waiting = links.data?.some((link) => link.role === 'child' && link.status === 'confirming');
  useEffect(() => {
    if (waiting !== true) return;
    toast.info(t('guardians.parentTook'));
    router.replace('/guardians');
  }, [waiting, t]);

  const size = Math.min(width - space.xxxl * 2, MAX_QR);
  const share = async () => {
    if (code.data === undefined) return;
    try {
      await Share.share({ message: t('guardians.shareMessage', { link: code.data.link }) });
    } catch (error) {
      toast.error(errorMessage(error, t));
    }
  };

  return (
    <Screen
      title={t('guardians.codeTitle')}
      testID="guardian-code"
      footer={
        <>
          <Button
            label={t('add.qr.share')}
            icon={Share2}
            variant="secondary"
            disabled={code.data === undefined}
            onPress={() => void share()}
          />
          <Button
            label={t('add.qr.renew')}
            icon={RefreshCw}
            variant="ghost"
            loading={code.isFetching}
            onPress={() => void code.refetch()}
          />
        </>
      }
    >
      <View style={styles.code}>
        {code.data === undefined ? (
          code.isError ? (
            <Text variant="callout" color="danger" align="center">
              {errorMessage(code.error, t)}
            </Text>
          ) : (
            <Skeleton width={size} height={size} />
          )
        ) : (
          <QrCode
            key={code.data.token}
            value={code.data.link}
            size={size}
            label={t('guardians.codeLabel')}
          />
        )}
      </View>
      <Text variant="callout" color="textMuted" align="center">
        {t('guardians.codeBody')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { alignItems: 'center', paddingVertical: space.lg },
});

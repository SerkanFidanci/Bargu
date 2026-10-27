import { COMMUNITY_RULES_URL, type RulesState } from '@bargu/schemas';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { space } from '@/theme';
import { Button } from '@/ui/button';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { queryClient } from '../query-client';
import { rulesAccepted, rulesApi, rulesKey } from './rules-state';

/**
 * The community rules (Play's rule for user content, K14; docs/play-store/TOPLULUK-KURALLARI.md):
 * shown once, before one's first message or photo, and again when their version goes up or the
 * server has no record of them. The server refuses messages and photos until they are accepted.
 */

/** The rules' own items, in the order of the text. */
const FORBIDDEN = ['children', 'harassment', 'intimate', 'sexual', 'violence', 'scams'] as const;

export interface RulesGate {
  /** Runs `action` once the rules are accepted: at once, or after "Kabul ediyorum". */
  ensure: (action: () => void) => void;
  /** The rules' sheet, to render once in the screen. */
  sheet: ReactNode;
}

/** The gate before a message, a photo or a story (K14). */
export function useRulesGate(): RulesGate {
  const { t } = useTranslation();
  const signedIn = useAuth((state) => state.userId !== null);
  const rules = useQuery({
    queryKey: rulesKey,
    queryFn: () => rulesApi.get(),
    enabled: signedIn,
    staleTime: Infinity,
  });
  const ref = useRef<SheetRef>(null);
  const pending = useRef<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);

  const ensure = (action: () => void) => {
    // The cache as it is now: a refusal from the server may have just forgotten them.
    if (rulesAccepted(queryClient.getQueryData<RulesState>(rulesKey) ?? rules.data)) {
      action();
      return;
    }
    pending.current = action;
    ref.current?.present();
  };

  const accept = () => {
    setSaving(true);
    rulesApi.accept().then(
      (state) => {
        setSaving(false);
        queryClient.setQueryData(rulesKey, state);
        ref.current?.dismiss();
        const action = pending.current;
        pending.current = null;
        action?.();
      },
      () => {
        setSaving(false);
        toast.error(t('messages.rules.failed'));
      },
    );
  };

  const sheet = (
    <Sheet
      ref={ref}
      title={t('messages.rules.title')}
      testID="rules-sheet"
      onDismiss={() => {
        pending.current = null;
      }}
    >
      <Text variant="body">{t('messages.rules.intro')}</Text>
      <View style={styles.list}>
        <Text variant="bodyStrong">{t('messages.rules.forbidden')}</Text>
        {FORBIDDEN.map((item) => (
          <Text key={item} variant="body">
            {`• ${t(`messages.rules.items.${item}`)}`}
          </Text>
        ))}
      </View>
      <Text variant="body">{t('messages.rules.closing')}</Text>
      <View style={styles.actions}>
        <Button
          testID="rules-accept"
          label={t('messages.rules.accept')}
          loading={saving}
          onPress={accept}
        />
        <Button
          testID="rules-full"
          label={t('messages.rules.full')}
          variant="ghost"
          onPress={() => {
            void Linking.openURL(COMMUNITY_RULES_URL);
          }}
        />
      </View>
    </Sheet>
  );

  return { ensure, sheet };
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  actions: { gap: space.sm },
});

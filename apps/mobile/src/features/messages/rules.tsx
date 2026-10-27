import { COMMUNITY_RULES_URL, type RulesState } from '@bargu/schemas';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { space } from '@/theme';
import { Button } from '@/ui/button';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { queryClient } from '../query-client';
import { rulesAccepted, rulesApi, rulesKey, rulesWereAccepted } from './rules-state';

/**
 * The community rules (Play's rule for user content, K14; docs/play-store/TOPLULUK-KURALLARI.md):
 * shown once, at whichever comes first: the Messages section opening, a photo or story opening, or
 * a first message (the PM, after QA-38b). Content stays closed until they are accepted, so whoever
 * sees a photo has accepted them and its screenshot notice always goes. Shown again when their
 * version goes up or the server has no record of them; the server refuses messages and photos
 * until then.
 */

/** The rules' own items, in the order of the text. */
const FORBIDDEN = ['children', 'harassment', 'intimate', 'sexual', 'violence', 'scams'] as const;

export interface RulesGate {
  /** Runs `action` once the rules are accepted: at once, or after "Kabul ediyorum". */
  ensure: (action: () => void) => void;
  /**
   * Whether content may be shown: accepted, or the server could not be asked (offline: what this
   * phone already holds stays readable; sending still waits for the rules).
   */
  open: boolean;
  /** The rules' sheet, to render once in the screen. */
  sheet: ReactNode;
}

/**
 * The gate before a message, a photo or a story (K14). `atOpen`: the screen is content (the list,
 * a conversation, a photo, a story), so the rules come as it opens, and closing them unaccepted
 * leaves it.
 */
export function useRulesGate(options: { atOpen?: boolean } = {}): RulesGate {
  const atOpen = options.atOpen ?? false;
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
  const accepted = rulesAccepted(rules.data);
  const known = rules.isSuccess;
  const open = accepted || rules.isError;

  useEffect(() => {
    if (atOpen && known && !accepted) ref.current?.present();
  }, [atOpen, known, accepted]);

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
        rulesWereAccepted(state);
        // What waited is taken before the sheet closes (closing forgets it).
        const action = pending.current;
        pending.current = null;
        ref.current?.dismiss();
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
        // Closed without accepting them: a screen of content is left (K14).
        if (atOpen && !rulesAccepted(queryClient.getQueryData<RulesState>(rulesKey))) {
          router.back();
        }
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

  return { ensure, open, sheet };
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  actions: { gap: space.sm },
});

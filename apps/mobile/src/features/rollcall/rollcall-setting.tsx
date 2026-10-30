import type { RollcallSetting } from '@bargu/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Toggle } from '@/ui/toggle';
import { toast } from '@/ui/toast';

import { rollcallApi } from './rollcall-api';

export const rollcallSettingKey = ['rollcall', 'setting'] as const;

/**
 * "Etkinlik yoklamaları" (docs/ADR/0040 §6): anyone can turn roll calls off; then no "Herkes yerinde
 * mi?" comes to them. Kept on the server, which fixes who a roll call asks when it begins.
 */
export function RollcallSettingToggle() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setting = useQuery({ queryKey: rollcallSettingKey, queryFn: () => rollcallApi.setting() });
  const change = useMutation({
    mutationFn: (on: boolean) => rollcallApi.setSetting(on),
    onSuccess: (next: RollcallSetting) => {
      queryClient.setQueryData(rollcallSettingKey, next);
    },
    onError: () => {
      toast.error(t('rollcall.refused.failed'));
    },
  });
  if (setting.data === undefined) return null;
  return (
    <Toggle
      testID="rollcall-setting"
      label={t('rollcall.setting')}
      description={t('rollcall.settingHint')}
      value={change.isPending ? change.variables : setting.data.on}
      disabled={change.isPending}
      onChange={(on) => {
        change.mutate(on);
      }}
    />
  );
}

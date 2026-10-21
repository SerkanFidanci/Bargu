import { Ban, Map as MapIcon, Moon, Sparkle, Sparkles, Sun } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { setEffectLevel } from '@/features/home/effect-prefs';
import { MAP_APPEARANCES, useMapAppearance } from '@/features/map/appearance';
import { space } from '@/theme';
import { EFFECT_LEVELS, useDeviceSaving, useEffectChoice } from '@/theme/effects';
import { Hint } from '@/ui/hint';
import { Screen } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';

const APPEARANCE_ICONS = { auto: MapIcon, light: Sun, dark: Moon } as const;
const EFFECT_ICONS = { full: Sparkles, reduced: Sparkle, off: Ban } as const;

/** "Görünüm ve harita" (from Me): the map's light or dark look, and how much moves (sade mod). */
export default function LookSettingsScreen() {
  const { t } = useTranslation();
  const appearance = useMapAppearance((state) => state.mode);
  const setAppearance = useMapAppearance((state) => state.setMode);
  const effects = useEffectChoice((state) => state.level);
  const systemReduced = useReducedMotion();
  // Battery saving plays "full" as "less" for now (docs/ADR/0027): said so, not a frozen map.
  const saving = useDeviceSaving((state) => state.saving);
  return (
    <Screen title={t('sheets.me.sectionLook')} testID="look-settings">
      <Segmented
        testID="map-appearance"
        label={t('sheets.me.mapAppearance')}
        value={appearance}
        onChange={setAppearance}
        options={MAP_APPEARANCES.map((value) => ({
          value,
          label: t(`sheets.me.mapAppearance_${value}`),
          icon: APPEARANCE_ICONS[value],
        }))}
      />
      <View style={styles.effects}>
        <Segmented
          testID="effects-level"
          label={t('sheets.me.effects')}
          value={effects}
          onChange={setEffectLevel}
          options={EFFECT_LEVELS.map((value) => ({
            value,
            label: t(`sheets.me.effects_${value}`),
            icon: EFFECT_ICONS[value],
          }))}
        />
        <Hint>
          {systemReduced
            ? t('sheets.me.effectsSystem')
            : saving && effects === 'full'
              ? t('sheets.me.effectsSaving')
              : t(`sheets.me.effectsDetail_${effects}`)}
        </Hint>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  effects: { gap: space.sm },
});

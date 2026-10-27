import { useLocalSearchParams } from 'expo-router';
import { Palette, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlan } from '@/features/billing/plan';
import { usePlusShelf } from '@/features/billing/plus-shelf';
import { PinLooks } from '@/features/cosmetics/pin-looks';
import { Screen } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';

const SHELVES = ['plus', 'looks'] as const;
type Shelf = (typeof SHELVES)[number];
const isShelf = (value: unknown): value is Shelf => SHELVES.some((shelf) => shelf === value);

/**
 * "Mağaza" (the owner, 2026-10-27: "halka desni ve pin çerçevelerini mağaza kısmı yap oraya al
 * aboneliklerde orada olsun ... abonelik alan hep o mağazadan olsun"; docs/ADR/0025 Ek 2): every
 * purchase in one place, on two shelves, Bargu+ and the pin looks (ring patterns, frames). The map's
 * store button, Me, a paused circle and the trial's reminder all open it; a `shelf` says which
 * shelf, otherwise Bargu+ for those without it and the pin looks for those with it.
 */
export default function StoreScreen() {
  const { t } = useTranslation();
  const { shelf: asked } = useLocalSearchParams<{ shelf?: string }>();
  const subscribed = usePlan().data?.plan === 'plus';
  // Until the user picks one: the shelf asked for, else the one that fits the plan once it is known.
  const [picked, setPicked] = useState<Shelf | null>(isShelf(asked) ? asked : null);
  const shelf = picked ?? (subscribed ? 'looks' : 'plus');
  const plus = usePlusShelf();
  return (
    <Screen
      title={t('store.title')}
      subtitle={t('store.subtitle')}
      footer={shelf === 'plus' ? plus.footer : undefined}
      testID="store-screen"
    >
      <Segmented
        testID="store-shelf"
        label={t('store.shelves')}
        value={shelf}
        onChange={setPicked}
        options={[
          { value: 'plus', label: t('store.shelf_plus'), icon: Sparkles },
          { value: 'looks', label: t('store.shelf_looks'), icon: Palette },
        ]}
      />
      {shelf === 'plus' ? plus.content : <PinLooks />}
    </Screen>
  );
}

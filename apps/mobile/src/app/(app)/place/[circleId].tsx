import { PLACE_NAME_MAX } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyFix } from '@/features/location/engine';
import { BarguMap } from '@/features/map/bargu-map';
import { loadMuteSettings, updateMutes } from '@/features/notifications/mute-session';
import { useMutes, withPlaceMuted } from '@/features/notifications/mutes';
import { PlaceCircle, useEditorView } from '@/features/places/place-editor';
import { DEFAULT_RADIUS, PLACE_RADII } from '@/features/places/place-model';
import { usePlaces } from '@/features/places/places';
import { places } from '@/features/places/places-session';
import { radius, space, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

const EMOJIS = ['🏠', '🏫', '🏢', '🏋️', '☕', '🛒', '❤️', '📍'] as const;
/** Zoom that shows a place of each size whole, with some room around it. */
const ZOOM_FOR: Record<(typeof PLACE_RADII)[number], number> = { 100: 16.2, 250: 15, 500: 14 };
/** Somewhere to start when nothing better is known (Istanbul). */
const FALLBACK: [number, number] = [28.9784, 41.0082];

/**
 * Adds or edits a place of a circle (BARGU_PLAN §4.3 "Yerler"): the map with the place's circle
 * over its centre, its name and icon. Sealed on this phone before it goes to the server.
 */
export default function PlaceEditor() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { circleId, id } = useLocalSearchParams<{ circleId: string; id?: string }>();
  const existing = usePlaces((state) => (id === undefined ? undefined : state[id]));
  const myFix = useMyFix((state) => state.fix);
  const mutes = useMutes();
  loadMuteSettings();

  const start: [number, number] =
    existing === undefined
      ? myFix === null
        ? FALLBACK
        : [myFix.lng, myFix.lat]
      : [existing.lng, existing.lat];
  const [center, setCenter] = useState<[number, number]>(start);
  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState<string>(existing?.emoji ?? EMOJIS[0]);
  const [size, setSize] = useState<number>(existing?.radius ?? DEFAULT_RADIUS);
  const [saving, setSaving] = useState(false);
  const startZoom = ZOOM_FOR[size === 100 || size === 500 ? size : 250];
  const { view, onViewChange } = useEditorView({ zoom: startZoom, lat: start[1] });

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= PLACE_NAME_MAX;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const result = await places.save(circleId, {
      ...(existing === undefined ? {} : { id: existing.id }),
      name: trimmed,
      emoji,
      lat: center[1],
      lng: center[0],
      radius: size,
    });
    setSaving(false);
    if (result === 'saved') {
      feedback('success');
      toast.success(t('places.saved'));
      router.back();
    } else if (result === 'conflict') {
      toast.info(t('places.conflict'));
    } else if (result === 'full') {
      toast.error(t('places.full'));
    } else {
      toast.error(t('places.failed'));
    }
  };

  const remove = () => {
    if (existing === undefined) return;
    Alert.alert(t('places.delete'), t('places.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('places.delete'),
        style: 'destructive',
        onPress: () => {
          void places.remove(existing).then((done) => {
            if (done) {
              toast.success(t('places.deleted'));
              router.back();
            } else {
              toast.error(t('places.failed'));
            }
          });
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.map}>
        <BarguMap
          insets={{}}
          focus={start}
          focusZoom={startZoom}
          onViewChange={(next) => {
            onViewChange(next);
            setCenter(next.center);
          }}
        />
        <PlaceCircle view={view} radius={size} onRadius={setSize} />
        <View style={[styles.close, { top: insets.top + space.sm }]}>
          <IconButton
            icon={X}
            label={t('common.close')}
            onPress={() => {
              router.back();
            }}
          />
        </View>
      </View>
      <ScrollView
        style={[styles.panel, { backgroundColor: colors.surface }]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="headline">
          {existing === undefined ? t('places.newTitle') : t('places.editTitle')}
        </Text>
        <Text variant="caption" color="textMuted">
          {t('places.moveHint')} · {t('places.sizeHint')}
        </Text>
        <View style={styles.row}>
          {PLACE_RADII.map((option) => (
            <PressableScale
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: option === size }}
              onPress={() => {
                feedback('select');
                setSize(option);
              }}
              style={[
                styles.chip,
                {
                  backgroundColor: option === size ? colors.primary : colors.surfaceRaised,
                },
              ]}
            >
              <Text variant="callout" color={option === size ? 'onPrimary' : 'text'}>
                {t('places.meters', { meters: option })}
              </Text>
            </PressableScale>
          ))}
        </View>
        <TextField
          testID="place-name"
          label={t('places.name')}
          placeholder={t('places.namePlaceholder')}
          value={name}
          onChangeText={setName}
          maxLength={PLACE_NAME_MAX}
          returnKeyType="done"
        />
        <Text variant="subhead">{t('places.emoji')}</Text>
        <View style={styles.row}>
          {EMOJIS.map((option) => (
            <PressableScale
              key={option}
              accessibilityRole="button"
              accessibilityLabel={option}
              accessibilityState={{ selected: option === emoji }}
              onPress={() => {
                feedback('select');
                setEmoji(option);
              }}
              style={[
                styles.emoji,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: option === emoji ? colors.primary : 'transparent',
                },
              ]}
            >
              <Text variant="headline" allowFontScaling={false}>
                {option}
              </Text>
            </PressableScale>
          ))}
        </View>
        {existing === undefined ? null : (
          <Toggle
            testID="place-notify"
            label={t('places.notify')}
            value={mutes.places[existing.id] !== true}
            onChange={(on) => {
              updateMutes((all) => withPlaceMuted(all, existing.id, !on));
            }}
          />
        )}
        <Text variant="caption" color="textMuted">
          {t('places.encrypted')}
        </Text>
        <Button
          testID="place-save"
          label={t('places.save')}
          disabled={!valid}
          loading={saving}
          onPress={() => void save()}
        />
        {existing === undefined ? null : (
          <Button
            testID="place-delete"
            label={t('places.delete')}
            icon={Trash2}
            variant="ghost"
            onPress={remove}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  close: { position: 'absolute', left: space.lg },
  panel: {
    flexGrow: 0,
    maxHeight: '55%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  content: { padding: space.xl, gap: space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  emoji: {
    width: space.xxxl,
    height: space.xxxl,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { useScreenshotListener } from 'expo-screen-capture';
import { router, useLocalSearchParams } from 'expo-router';
import { MoreVertical, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { useMessages } from '@/features/messages/messages';
import { loadMessagesOnce } from '@/features/messages/messages-session';
import { memberIn } from '@/features/messages/names';
import { takeBack, tellScreenshot } from '@/features/messages/outbox';
import { openPhoto } from '@/features/messages/photo';
import { useSafety } from '@/features/messages/safety';
import { mediaColors, space } from '@/theme';
import { IconButton } from '@/ui/icon-button';
import { Text } from '@/ui/text';

/**
 * One photo of a conversation (docs/ADR/0035 §4, §12): opened here from its sealed file with its
 * item's key, kept in memory only while shown. Someone else's: "Bildir" and "Engelle" are a tap
 * away, and a screenshot (Android 14+) tells its sender. One's own: who took a screenshot, and
 * "Herkesten sil".
 */
export default function PhotoScreen() {
  const { t, i18n } = useTranslation();
  const { item: id } = useLocalSearchParams<{ item: string }>();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const item = useMessages((state) => state.items.find((kept) => kept.id === id));
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const told = useRef(false);
  const safety = useSafety(() => {
    router.back();
  });
  const photo = item?.photo;
  const mine = item?.from === me;

  useEffect(() => {
    loadMessagesOnce();
  }, []);
  useEffect(() => {
    if (photo === undefined) return;
    let shown = true;
    openPhoto(photo).then(
      (opened) => {
        if (shown) setUri(opened);
      },
      () => {
        if (shown) setFailed(true);
      },
    );
    return () => {
      shown = false;
      setUri(null);
    };
  }, [photo]);

  // A screenshot of someone else's photo tells its sender, once per opening (docs/ADR/0035 §12).
  useScreenshotListener(() => {
    if (item === undefined || mine || told.current) return;
    told.current = true;
    void tellScreenshot(item);
  });

  const nameOf = (userId: string) => {
    const member = memberIn(circles, userId);
    return member === undefined ? '?' : memberName(member);
  };

  const menu = () => {
    if (item === undefined) return;
    if (!mine) {
      safety.itemMenu(item);
      return;
    }
    Alert.alert(t('messages.takeBack'), t('messages.takeBackBody'), [
      {
        text: t('messages.takeBack'),
        style: 'destructive',
        onPress: () => {
          void takeBack(item.id);
          router.back();
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const time =
    item === undefined
      ? ''
      : new Date(item.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const shotBy = mine ? (item.shotBy ?? []) : [];

  return (
    <View style={[styles.screen, styles.dark]} testID="photo">
      {uri === null ? null : (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessible
          accessibilityLabel={photo?.caption ?? t('messages.photo')}
        />
      )}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.bar, styles.shade]}>
          <IconButton
            testID="photo-close"
            icon={X}
            label={t('messages.camera.close')}
            tone="raised"
            onPress={() => {
              router.back();
            }}
          />
          <View style={styles.who}>
            <Text variant="bodyStrong" style={styles.light} numberOfLines={1}>
              {item === undefined ? '' : mine ? t('messages.you') : nameOf(item.from)}
            </Text>
            <Text variant="footnote" style={styles.light}>
              {time}
            </Text>
          </View>
          {item === undefined ? null : (
            <IconButton
              testID="photo-more"
              icon={MoreVertical}
              label={t('messages.itemActions')}
              tone="raised"
              onPress={menu}
            />
          )}
        </View>

        {item === undefined ? (
          <View style={styles.center}>
            <Text variant="body" align="center" style={styles.light}>
              {t('messages.photoGone')}
            </Text>
          </View>
        ) : failed ? (
          <View style={styles.center}>
            <Text variant="body" align="center" style={styles.light}>
              {t('messages.photoFailed')}
            </Text>
          </View>
        ) : uri === null ? (
          <ActivityIndicator
            color={mediaColors.onBackdrop}
            accessibilityLabel={t('messages.opening')}
          />
        ) : (
          <View />
        )}

        <View style={styles.bottom}>
          {photo?.caption === undefined ? null : (
            <Text variant="body" style={[styles.light, styles.shade, styles.caption]}>
              {photo.caption}
            </Text>
          )}
          {shotBy.length === 0 ? null : (
            <Text variant="footnote" style={[styles.light, styles.shade, styles.caption]}>
              {t('messages.shotBy', { names: shotBy.map(nameOf).join(', ') })}
            </Text>
          )}
        </View>
      </SafeAreaView>
      {safety.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dark: { backgroundColor: mediaColors.backdrop },
  overlay: { flex: 1, justifyContent: 'space-between' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  shade: { backgroundColor: mediaColors.shade },
  who: { flex: 1 },
  light: { color: mediaColors.onBackdrop },
  center: { padding: space.xl },
  bottom: { gap: space.xs, padding: space.md },
  caption: { paddingHorizontal: space.md, paddingVertical: space.sm },
});

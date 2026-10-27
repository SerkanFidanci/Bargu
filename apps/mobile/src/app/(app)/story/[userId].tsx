import { CHAT_TEXT_MAX, codePointsOf } from '@bargu/schemas';
import { useScreenshotListener } from 'expo-screen-capture';
import { router, useLocalSearchParams } from 'expo-router';
import { MoreVertical, Send, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import {
  type ChatItem,
  personConversation,
  storiesOf,
  useMessages,
} from '@/features/messages/messages';
import { loadMessagesOnce, markViewed } from '@/features/messages/messages-session';
import { isOpen, memberIn } from '@/features/messages/names';
import { sendText, takeBackPhoto, tellScreenshot } from '@/features/messages/outbox';
import { openPhoto } from '@/features/messages/photo';
import { useSafety } from '@/features/messages/safety';
import { mediaColors, radius, space, storyFx, touchTarget, typography } from '@/theme';
import { IconButton } from '@/ui/icon-button';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * One person's stories (docs/ADR/0035 §1, §8, §12): each photo for five seconds, a tap on the left
 * goes back, on the right forward; the first not yet seen comes first. Seen ones turn the ring on
 * their pin grey. Someone else's: a reply goes to them alone as a personal item, "Bildir" and
 * "Engelle" are a tap away, a screenshot tells them. One's own: who took a screenshot, and
 * "Herkesten sil" for every circle it went to.
 */
export default function StoryScreen() {
  const { t, i18n } = useTranslation();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const items = useMessages((state) => state.items);
  const viewed = useMessages((state) => state.viewed);
  const stories =
    storiesOf({ items, viewed }, me).find((person) => person.userId === userId)?.stories ?? [];
  const mine = userId === me;
  const [index, setIndex] = useState(() => {
    if (mine) return 0;
    const first = stories.findIndex(
      (story) => story.photo !== undefined && viewed[story.photo.blobId] === undefined,
    );
    return Math.max(0, first);
  });
  const story: ChatItem | undefined = stories[Math.min(index, stories.length - 1)];
  const photo = story?.photo;
  // What was opened, by file: moving to another story shows nothing until it is open.
  const [opened, setOpened] = useState<{ blobId: string; uri: string } | null>(null);
  const [failedFile, setFailedFile] = useState<string | null>(null);
  const uri = photo !== undefined && opened?.blobId === photo.blobId ? opened.uri : null;
  const failed = failedFile !== null && failedFile === photo?.blobId;
  const [reply, setReply] = useState('');
  const [paused, setPaused] = useState(false);
  const progress = useSharedValue(0);
  const told = useRef(new Set<string>());
  const safety = useSafety(() => {
    router.back();
  });

  useEffect(() => {
    loadMessagesOnce();
  }, []);

  const count = stories.length;
  const forward = useCallback(() => {
    if (index + 1 < count) setIndex(index + 1);
    else router.back();
  }, [index, count]);
  const backward = () => {
    if (index > 0) setIndex(index - 1);
    else progress.set(0);
  };

  // Open this one; it counts as seen once shown.
  useEffect(() => {
    if (photo === undefined) return;
    let shown = true;
    progress.set(0);
    openPhoto(photo).then(
      (image) => {
        if (!shown) return;
        setOpened({ blobId: photo.blobId, uri: image });
        markViewed(photo.blobId);
      },
      () => {
        if (shown) setFailedFile(photo.blobId);
      },
    );
    return () => {
      shown = false;
    };
  }, [photo, progress]);

  // The bar fills on the UI thread; when it is full, the next story.
  useEffect(() => {
    if (uri === null || paused) {
      cancelAnimation(progress);
      return;
    }
    const left = (1 - progress.get()) * storyFx.show;
    progress.set(
      withTiming(1, { duration: left, easing: Easing.linear }, (finished) => {
        if (finished === true) scheduleOnRN(forward);
      }),
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [uri, paused, forward, progress]);

  useScreenshotListener(() => {
    if (story === undefined || mine || photo === undefined || told.current.has(photo.blobId))
      return;
    told.current.add(photo.blobId);
    void tellScreenshot(story);
  });

  if (story === undefined || photo === undefined) {
    return (
      <SafeAreaView style={[styles.screen, styles.dark, styles.center]}>
        <Text variant="body" align="center" style={styles.light}>
          {t('messages.story.gone')}
        </Text>
        <IconButton
          icon={X}
          label={t('messages.camera.close')}
          tone="raised"
          onPress={() => {
            router.back();
          }}
        />
      </SafeAreaView>
    );
  }

  const nameOf = (id: string) => {
    const member = memberIn(circles, id);
    return member === undefined ? '?' : memberName(member);
  };
  const time = new Date(story.at).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const canReply = !mine && isOpen(personConversation(userId), circles, me);
  const shotBy = mine
    ? [
        ...new Set(
          items
            .filter((item) => item.from === me && item.photo?.blobId === photo.blobId)
            .flatMap((item) => item.shotBy ?? []),
        ),
      ]
    : [];

  const menu = () => {
    if (!mine) {
      safety.itemMenu(story);
      return;
    }
    setPaused(true);
    Alert.alert(t('messages.takeBack'), t('messages.story.takeBackBody'), [
      {
        text: t('messages.takeBack'),
        style: 'destructive',
        onPress: () => {
          void takeBackPhoto(photo.blobId);
          setPaused(false);
          forward();
        },
      },
      {
        text: t('common.cancel'),
        style: 'cancel',
        onPress: () => {
          setPaused(false);
        },
      },
    ]);
  };

  const sendReply = () => {
    const text = reply.trim();
    if (text.length === 0) return;
    setReply('');
    void sendText(personConversation(userId), text, story.id).then((result) => {
      if (result === 'sent') toast.success(t('messages.story.replied'));
      else if (result === 'limited') toast.info(t('messages.limited'));
      else toast.error(t('messages.camera.notSent'));
    });
  };

  return (
    <View style={[styles.screen, styles.dark]} testID="story">
      {uri === null ? null : (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessible
          accessibilityLabel={
            photo.caption ?? t('messages.story.photoOf', { name: nameOf(userId) })
          }
        />
      )}
      <View style={[StyleSheet.absoluteFill, styles.taps]}>
        <Pressable
          testID="story-back"
          style={styles.tapBack}
          accessibilityRole="button"
          accessibilityLabel={t('messages.story.previous')}
          onPress={backward}
        />
        <Pressable
          testID="story-next"
          style={styles.tapNext}
          accessibilityRole="button"
          accessibilityLabel={t('messages.story.next')}
          onPress={forward}
        />
      </View>
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.top}>
          <View style={styles.bars}>
            {stories.map((each, at) => (
              <Bar
                key={each.id}
                state={at < index ? 'full' : at === index ? 'running' : 'empty'}
                progress={progress}
              />
            ))}
          </View>
          <View style={styles.bar}>
            <View style={styles.who}>
              <Text variant="bodyStrong" style={styles.light} numberOfLines={1}>
                {mine ? t('messages.you') : nameOf(userId)}
              </Text>
              <Text variant="footnote" style={styles.light}>
                {time}
              </Text>
            </View>
            <IconButton
              testID="story-more"
              icon={MoreVertical}
              label={t('messages.itemActions')}
              tone="raised"
              onPress={menu}
            />
            <IconButton
              testID="story-close"
              icon={X}
              label={t('messages.camera.close')}
              tone="raised"
              onPress={() => {
                router.back();
              }}
            />
          </View>
        </View>

        {failed ? (
          <Text variant="body" align="center" style={styles.light}>
            {t('messages.photoFailed')}
          </Text>
        ) : uri === null ? (
          <ActivityIndicator
            color={mediaColors.onBackdrop}
            accessibilityLabel={t('messages.opening')}
          />
        ) : null}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.bottom}
          pointerEvents="box-none"
        >
          {photo.caption === undefined ? null : (
            <Text variant="body" style={[styles.light, styles.shade, styles.caption]}>
              {photo.caption}
            </Text>
          )}
          {shotBy.length === 0 ? null : (
            <Text variant="footnote" style={[styles.light, styles.shade, styles.caption]}>
              {t('messages.shotBy', { names: shotBy.map(nameOf).join(', ') })}
            </Text>
          )}
          {canReply ? (
            <View style={[styles.reply, { borderColor: mediaColors.track }]}>
              <TextInput
                testID="story-reply"
                value={reply}
                onChangeText={(next) => {
                  if (codePointsOf(next) <= CHAT_TEXT_MAX) setReply(next);
                }}
                onFocus={() => {
                  setPaused(true);
                }}
                onBlur={() => {
                  setPaused(false);
                }}
                placeholder={t('messages.story.reply', { name: nameOf(userId) })}
                placeholderTextColor={mediaColors.track}
                accessibilityLabel={t('messages.story.reply', { name: nameOf(userId) })}
                style={[styles.replyInput, typography.body.style, styles.light]}
              />
              <IconButton
                testID="story-reply-send"
                icon={Send}
                label={t('messages.send')}
                tone={reply.trim().length === 0 ? 'raised' : 'primary'}
                onPress={sendReply}
              />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
      {safety.sheet}
    </View>
  );
}

/** One story's bar at the top: full, filling, or empty. */
function Bar({
  state,
  progress,
}: {
  state: 'full' | 'running' | 'empty';
  progress: SharedValue<number>;
}) {
  const filled = useAnimatedStyle(() => ({
    transform: [{ scaleX: state === 'full' ? 1 : state === 'running' ? progress.get() : 0 }],
  }));
  return (
    <View style={[styles.track, { backgroundColor: mediaColors.track }]}>
      <Animated.View style={[styles.fill, { backgroundColor: mediaColors.onBackdrop }, filled]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dark: { backgroundColor: mediaColors.backdrop },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  taps: { flexDirection: 'row' },
  tapBack: { flex: 1 },
  tapNext: { flex: 2 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm },
  bars: { flexDirection: 'row', gap: space.xs },
  track: { flex: 1, height: storyFx.bar, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { width: '100%', height: storyFx.bar, transformOrigin: 'left' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  who: { flex: 1 },
  light: { color: mediaColors.onBackdrop },
  shade: { backgroundColor: mediaColors.shade },
  caption: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  bottom: { gap: space.sm, padding: space.md },
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  replyInput: { flex: 1, minHeight: touchTarget },
});

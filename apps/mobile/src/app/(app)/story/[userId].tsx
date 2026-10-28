import { CHAT_TEXT_MAX, type ChatReaction, codePointsOf } from '@bargu/schemas';
import { useScreenshotListener } from 'expo-screen-capture';
import { router, useLocalSearchParams } from 'expo-router';
import { Eye, Heart, MoreVertical, Send, X } from 'lucide-react-native';
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
  storyReactions,
  useMessages,
  viewersOf,
} from '@/features/messages/messages';
import { ReactionBar } from '@/features/messages/item-sheet';
import { loadMessagesOnce, markViewed } from '@/features/messages/messages-session';
import { isOpen, memberIn } from '@/features/messages/names';
import {
  react,
  sendText,
  takeBackPhoto,
  tellScreenshot,
  tellViewed,
} from '@/features/messages/outbox';
import { openPhoto } from '@/features/messages/photo';
import { useRulesGate } from '@/features/messages/rules';
import { useSafety } from '@/features/messages/safety';
import { firstViewNotice } from '@/features/messages/view-notice';
import { mediaColors, radius, space, storyFx, touchTarget, typography } from '@/theme';
import { useEffects } from '@/theme/effects';
import { Avatar } from '@/ui/avatar';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * One person's stories (docs/ADR/0035 §1, §8, §12): each photo for five seconds, a tap on the left
 * goes back, on the right forward; the first not yet seen comes first. Seen ones turn the ring on
 * their pin grey. Someone else's: a reply goes to them alone as a personal item, "Bildir" and
 * "Engelle" are a tap away, a screenshot tells them, and opening it tells them it was seen (Ek 1).
 * One's own: who saw it and who took a screenshot, and "Herkesten sil" for every circle it went to.
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
  // The first story of someone else opened on this phone: its sender sees it was (Ek 1).
  const [notice, setNotice] = useState(false);
  // The six reactions over the reply, after holding the heart (Ek 2); the story waits meanwhile.
  const [choosing, setChoosing] = useState(false);
  const progress = useSharedValue(0);
  const told = useRef(new Set<string>());
  const seenSheet = useRef<SheetRef>(null);
  const safety = useSafety(() => {
    router.back();
  });
  // The community rules before any story opens (K14): whoever sees it has accepted them.
  const rules = useRulesGate({ atOpen: true });
  const open = rules.open;

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
    if (photo === undefined || !open) return;
    let shown = true;
    progress.set(0);
    stillLeft.current = storyFx.show;
    openPhoto(photo).then(
      (image) => {
        if (!shown) return;
        setOpened({ blobId: photo.blobId, uri: image });
        // The first time here: its sender is told it was seen (docs/ADR/0035 Ek 1).
        const messages = useMessages.getState();
        const item = messages.items.find(
          (each) => each.from === userId && each.photo?.blobId === photo.blobId,
        );
        if (!mine && item !== undefined && messages.viewed[photo.blobId] === undefined) {
          void tellViewed(item);
        }
        if (!mine && firstViewNotice()) setNotice(true);
        markViewed(photo.blobId);
      },
      () => {
        if (shown) setFailedFile(photo.blobId);
      },
    );
    return () => {
      shown = false;
    };
  }, [photo, progress, open, mine, userId]);

  // The bar fills on the UI thread; when it is full, the next story. Sade mod "Kapalı": the bar
  // stays still and the time still runs (QA-38).
  const still = useEffects() === 'off';
  /** Sade mod "Kapalı": the time this story has left, kept across a pause. */
  const stillLeft = useRef<number>(storyFx.show);
  useEffect(() => {
    if (uri === null || paused) {
      cancelAnimation(progress);
      return;
    }
    if (still) {
      // A pause keeps what was left of this story's time (QA-38b).
      const started = Date.now();
      const timer = setTimeout(forward, stillLeft.current);
      return () => {
        clearTimeout(timer);
        stillLeft.current = Math.max(0, stillLeft.current - (Date.now() - started));
      };
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
  }, [uri, paused, forward, progress, still]);

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
  const seenBy = mine ? viewersOf({ items }, me, photo.blobId) : [];
  const reactedBy = mine ? storyReactions({ items }, me, photo.blobId) : {};
  const myReaction = me === null ? undefined : story.reactions?.[me];
  const reactWith = (emoji: ChatReaction | null) => {
    setChoosing(false);
    setPaused(false);
    rules.ensure(() => {
      void react(story, emoji);
    });
  };
  const seenLabel =
    seenBy.length === 0
      ? t('messages.story.seenByNone')
      : t('messages.story.seenBy', { count: seenBy.length });
  const clock = (at: number) =>
    new Date(at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
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
    rules.ensure(() => {
      setReply('');
      void sendText(personConversation(userId), text, story.id).then((result) => {
        if (result === 'sent') toast.success(t('messages.story.replied'));
        else if (result === 'limited') toast.info(t('messages.limited'));
        else toast.error(t('messages.camera.notSent'));
      });
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
          {notice ? (
            <Text
              testID="story-view-notice"
              variant="footnote"
              style={[styles.light, styles.shade, styles.caption]}
            >
              {t('messages.story.viewNotice', { name: nameOf(userId) })}
            </Text>
          ) : null}
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
          {mine ? (
            <PressableScale
              testID="story-seen"
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={seenLabel}
              onPress={() => {
                setPaused(true);
                seenSheet.current?.present();
              }}
              style={[styles.seen, styles.shade]}
            >
              <Eye color={mediaColors.onBackdrop} size={18} strokeWidth={2.25} />
              <Text variant="subhead" style={styles.light}>
                {seenLabel}
              </Text>
            </PressableScale>
          ) : null}
          {canReply && choosing ? (
            <View style={[styles.choose, styles.shade]}>
              <ReactionBar testID="story-reactions" current={myReaction} onReact={reactWith} />
            </View>
          ) : null}
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
              {reply.trim().length === 0 ? (
                <PressableScale
                  testID="story-heart"
                  haptic="select"
                  accessibilityRole="button"
                  accessibilityLabel={
                    myReaction === '❤️' ? t('messages.react.heartBack') : t('messages.react.heart')
                  }
                  accessibilityHint={t('messages.react.choose')}
                  accessibilityState={{ selected: myReaction !== undefined }}
                  onPress={() => {
                    reactWith(myReaction === '❤️' ? null : '❤️');
                  }}
                  onLongPress={() => {
                    setPaused(true);
                    setChoosing(true);
                  }}
                  style={styles.heart}
                >
                  {myReaction === undefined || myReaction === '❤️' ? (
                    <Heart
                      color={mediaColors.onBackdrop}
                      fill={myReaction === '❤️' ? mediaColors.onBackdrop : 'transparent'}
                      size={touchTarget * 0.5}
                      strokeWidth={2.25}
                    />
                  ) : (
                    <Text style={typography.title2.style} allowFontScaling={false}>
                      {myReaction}
                    </Text>
                  )}
                </PressableScale>
              ) : null}
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
      {mine ? (
        <Sheet
          ref={seenSheet}
          title={t('messages.story.seenByTitle')}
          testID="story-seen-sheet"
          onDismiss={() => {
            setPaused(false);
          }}
        >
          {seenBy.length === 0 ? (
            <Text variant="body" color="textMuted">
              {t('messages.story.seenByNone')}
            </Text>
          ) : (
            seenBy.map((viewer) => (
              <ListRow
                key={viewer.userId}
                testID={`story-seen-${viewer.userId}`}
                leading={
                  <Avatar
                    avatar={memberIn(circles, viewer.userId)?.avatar ?? null}
                    name={nameOf(viewer.userId)}
                    userId={viewer.userId}
                  />
                }
                title={nameOf(viewer.userId)}
                subtitle={clock(viewer.at)}
                trailing={
                  reactedBy[viewer.userId] === undefined ? null : (
                    <Text
                      testID={`story-reacted-${viewer.userId}`}
                      accessibilityLabel={t('messages.react.of', {
                        emoji: reactedBy[viewer.userId],
                      })}
                      style={typography.title2.style}
                    >
                      {reactedBy[viewer.userId]}
                    </Text>
                  )
                }
              />
            ))
          )}
          <Text variant="footnote" color="textMuted">
            {t('messages.story.seenByNote')}
          </Text>
        </Sheet>
      ) : null}
      {safety.sheet}
      {rules.sheet}
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
  heart: {
    width: touchTarget,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choose: { padding: space.xs, borderRadius: radius.pill },
  seen: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    minHeight: touchTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
});

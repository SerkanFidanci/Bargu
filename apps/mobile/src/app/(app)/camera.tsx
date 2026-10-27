import { CHAT_CAPTION_MAX, codePointsOf } from '@bargu/schemas';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronLeft, RefreshCcw, Send, Users, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/auth-store';
import { useCircles } from '@/features/circles/queries';
import { type Conversation, personConversation } from '@/features/messages/messages';
import { conversationName, writablePeople } from '@/features/messages/names';
import { type SendResult, sendPhoto, shareStory } from '@/features/messages/outbox';
import { jpegUri, preparePhoto, sealPhoto, type TakenPhoto } from '@/features/messages/photo';
import { useRulesGate } from '@/features/messages/rules';
import { storyCircles } from '@/features/messages/stories';
import { mediaColors, radius, space, touchTarget, typography, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

const CONVERSATION = /^[cp]:[0-9a-f-]{36}$/;
const SHUTTER = touchTarget * 1.6;

/**
 * "Fotoğraf" (docs/ADR/0035 §1, §4): only the app's camera, that moment; no gallery. Opened from a
 * conversation, the photo goes there. Opened alone, one screen offers the three ways: "Hikaye
 * (bütün çemberlerim)" (every circle but events), "Çember seç" (events too), "Bir kişi". The photo
 * is made small and sealed on the phone; the camera's file does not stay.
 */
export default function CameraScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { to } = useLocalSearchParams<{ to?: string }>();
  const conversation = to !== undefined && CONVERSATION.test(to) ? (to as Conversation) : null;
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [taking, setTaking] = useState(false);
  const [taken, setTaken] = useState<{ photo: TakenPhoto; preview: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [step, setStep] = useState<'choose' | 'circles' | 'person'>('choose');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const rules = useRulesGate();

  const take = async () => {
    if (camera.current === null || taking) return;
    setTaking(true);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 1, exif: false });
      const photo = await preparePhoto(picture.uri, picture.width, picture.height);
      setTaken({ photo, preview: jpegUri(photo.jpeg) });
    } catch {
      toast.error(t('messages.camera.failed'));
    } finally {
      setTaking(false);
    }
  };

  /** Sends in the background: the item shows as "sending" where it went, and can be tried again. */
  const send = (target: { conversation: Conversation } | { circleIds: string[] }) => {
    rules.ensure(() => {
      sendNow(target);
    });
  };
  const sendNow = (target: { conversation: Conversation } | { circleIds: string[] }) => {
    if (taken === null) return;
    const file = sealPhoto(taken.photo);
    const words = caption.trim() === '' ? undefined : caption.trim();
    setTaken(null);
    router.back();
    if ('conversation' in target) {
      void sendPhoto(target.conversation, file, words).then((result) => {
        tell(result, false);
      });
      return;
    }
    void shareStory(target.circleIds, file, words).then(({ result, failed, total }) => {
      // Some of its places took it, some did not: say how many, each shows in its conversation.
      if (failed > 0 && failed < total) {
        toast.error(t('messages.camera.partly', { count: failed }));
        return;
      }
      tell(result, true);
    });
  };
  const tell = (result: SendResult, story: boolean) => {
    if (result === 'sent')
      toast.success(t(story ? 'messages.camera.shared' : 'messages.camera.sent'));
    else if (result === 'full') toast.info(t('messages.camera.full'));
    else if (result === 'limited') toast.info(t('messages.limited'));
    else toast.error(t('messages.camera.notSent'));
  };

  if (permission === null) return <View style={[styles.screen, styles.dark]} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <Bar onClose={router.back} label={t('messages.camera.close')} tone="plain" />
        <View style={styles.center}>
          <EmptyState
            icon={Camera}
            title={t('messages.camera.permissionTitle')}
            body={t('messages.camera.permissionBody')}
            action={
              permission.canAskAgain
                ? {
                    label: t('messages.camera.allow'),
                    onPress: () => {
                      void requestPermission();
                    },
                  }
                : {
                    label: t('messages.camera.settings'),
                    onPress: () => {
                      void Linking.openSettings();
                    },
                  }
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  if (taken === null) {
    return (
      <View style={[styles.screen, styles.dark]} testID="camera">
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} />
        <SafeAreaView style={styles.overlay} pointerEvents="box-none">
          <View style={styles.topBar}>
            <IconButton
              testID="camera-close"
              icon={X}
              label={t('messages.camera.close')}
              tone="raised"
              onPress={() => {
                router.back();
              }}
            />
            <IconButton
              testID="camera-flip"
              icon={RefreshCcw}
              label={t('messages.camera.flip')}
              tone="raised"
              onPress={() => {
                setFacing((side) => (side === 'back' ? 'front' : 'back'));
              }}
            />
          </View>
          <View style={styles.shutterRow}>
            <PressableScale
              testID="camera-take"
              haptic="bump"
              accessibilityRole="button"
              accessibilityLabel={t('messages.camera.take')}
              accessibilityState={{ busy: taking }}
              disabled={taking}
              onPress={() => {
                void take();
              }}
              style={[styles.shutter, { borderColor: mediaColors.onBackdrop }]}
            >
              <View style={[styles.shutterInner, { backgroundColor: mediaColors.onBackdrop }]} />
            </PressableScale>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const audience = storyCircles(circles, me);
  const people = writablePeople(circles, me);
  const target = conversation === null ? null : conversationName(conversation, circles, me);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
      testID="camera-send"
    >
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.previewBar}>
          <IconButton
            testID="camera-retake"
            icon={step === 'choose' ? X : ChevronLeft}
            label={step === 'choose' ? t('messages.camera.retake') : t('common.back')}
            tone="plain"
            onPress={() => {
              if (step === 'choose') setTaken(null);
              else setStep('choose');
            }}
          />
        </View>
        <ScrollView contentContainerStyle={styles.sendBody} keyboardShouldPersistTaps="handled">
          <Image
            source={{ uri: taken.preview }}
            style={[styles.preview, { aspectRatio: taken.photo.w / taken.photo.h }]}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            accessible
            accessibilityLabel={t('messages.photo')}
          />
          <TextInput
            testID="camera-caption"
            value={caption}
            onChangeText={(next) => {
              if (codePointsOf(next) <= CHAT_CAPTION_MAX) setCaption(next);
            }}
            placeholder={t('messages.camera.caption')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('messages.camera.caption')}
            style={[
              styles.caption,
              typography.body.style,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          />
          {conversation !== null ? (
            <Button
              testID="camera-send-here"
              label={t('messages.camera.sendTo', { name: target ?? '' })}
              icon={Send}
              disabled={target === null}
              onPress={() => {
                send({ conversation });
              }}
            />
          ) : step === 'choose' ? (
            <View style={styles.choices}>
              <Button
                testID="camera-story"
                label={t('messages.camera.story')}
                icon={Users}
                disabled={audience.length === 0}
                onPress={() => {
                  send({ circleIds: audience.map((circle) => circle.id) });
                }}
              />
              <Text variant="footnote" color="textMuted">
                {audience.length === 0
                  ? t('messages.camera.noCircles')
                  : t('messages.camera.storyHint')}
              </Text>
              <Button
                testID="camera-pick-circles"
                label={t('messages.camera.pickCircles')}
                variant="secondary"
                onPress={() => {
                  setStep('circles');
                }}
              />
              <Button
                testID="camera-pick-person"
                label={t('messages.camera.pickPerson')}
                variant="secondary"
                disabled={people.length === 0}
                onPress={() => {
                  setStep('person');
                }}
              />
            </View>
          ) : step === 'circles' ? (
            <View style={styles.choices}>
              {storyCircles(circles, me, { events: true }).map((circle) => (
                <Toggle
                  key={circle.id}
                  testID={`camera-circle-${circle.id}`}
                  label={conversationName(`c:${circle.id}`, circles, me) ?? ''}
                  {...(circle.kind === 'event' ? { description: t('messages.camera.event') } : {})}
                  value={chosen.has(circle.id)}
                  onChange={(on) => {
                    setChosen((current) => {
                      const next = new Set(current);
                      if (on) next.add(circle.id);
                      else next.delete(circle.id);
                      return next;
                    });
                  }}
                />
              ))}
              <Button
                testID="camera-share-chosen"
                label={t('messages.camera.share')}
                disabled={chosen.size === 0}
                onPress={() => {
                  send({ circleIds: [...chosen] });
                }}
              />
            </View>
          ) : (
            <View style={styles.choices}>
              {people.map((person) => (
                <ListRow
                  key={person.userId}
                  testID={`camera-person-${person.userId}`}
                  leading={
                    <Avatar avatar={person.avatar} name={person.name} userId={person.userId} />
                  }
                  title={person.name}
                  onPress={() => {
                    send({ conversation: personConversation(person.userId) });
                  }}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {rules.sheet}
    </SafeAreaView>
  );
}

function Bar({
  onClose,
  label,
  tone,
}: {
  onClose: () => void;
  label: string;
  tone: 'plain' | 'raised';
}) {
  return (
    <View style={styles.previewBar}>
      <IconButton icon={X} label={label} tone={tone} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dark: { backgroundColor: mediaColors.backdrop },
  center: { flex: 1, justifyContent: 'center', padding: space.xl },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', padding: space.md },
  shutterRow: { alignItems: 'center', paddingBottom: space.xxl },
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: radius.pill,
    borderWidth: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: SHUTTER - space.lg,
    height: SHUTTER - space.lg,
    borderRadius: radius.pill,
  },
  previewBar: { flexDirection: 'row', paddingHorizontal: space.sm, paddingVertical: space.xs },
  sendBody: { padding: space.lg, gap: space.md },
  preview: { width: '100%', borderRadius: radius.lg, maxHeight: 420 },
  caption: {
    minHeight: touchTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  choices: { gap: space.sm },
});

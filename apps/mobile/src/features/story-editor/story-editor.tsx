import {
  Canvas,
  ColorMatrix,
  Image as SkiaImage,
  notifyChange,
  Path,
  Skia,
} from '@shopify/react-native-skia';
import {
  Check,
  PenLine,
  Smile,
  Trash2,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { editorFx, mediaColors, radius, space, touchTarget } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { PressableScale } from '@/ui/pressable-scale';
import { toast } from '@/ui/toast';

import type { TakenPhoto } from '../messages/photo';
import { composeEdit, TEXT_WIDTH } from './compose';
import {
  type Edit,
  fit,
  INK,
  inkOn,
  isEdited,
  NO_EDIT,
  type Overlay,
  PEN_WIDTHS,
  STICKERS,
  TEXT_SIZE,
  withOverlay,
  withoutLastStroke,
  withoutOverlay,
  withPlaced,
  withStroke,
} from './edit-model';
import { type FilterKey, filterMatrix, nextFilter } from './filters';
import { OverlayItem } from './overlay-item';

type Mode = 'idle' | 'text' | 'draw' | 'sticker';

/** Words being written: new, or ones already on the photo opened again. */
interface Draft {
  id: string | null;
  text: string;
  color: string;
  boxed: boolean;
}

const NEW_DRAFT: Draft = { id: null, text: '', color: INK[0], boxed: false };
/** Where a dragged overlay goes away: the bottom of the screen, this tall. */
const BIN_ZONE = touchTarget * 2;

/**
 * The photo before it goes, as Instagram's story editor (the owner, 2026-10-29: "Instagram gibi
 * düzenleme seçeneği"; docs/ADR/0035 Ek 3): swipe for a filter, "Aa" for words (a colour, plain or
 * on a box), a pen (colours, three widths, undo), emoji stickers; words and stickers dragged, sized
 * and turned by hand, dropped on the bin to go. Everything is drawn into the photo on this phone
 * (compose.ts) before it is sealed; no place or time sticker, nothing of where it was taken.
 */
export function StoryEditor({
  photo,
  onDone,
  onCancel,
}: {
  photo: TakenPhoto;
  onDone: (photo: TakenPhoto) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // A filter's name pops in; at sade mod "off" it only fades.
  const motion = useMotion();
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [edit, setEdit] = useState<Edit>(NO_EDIT);
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [pen, setPen] = useState<{ color: string; width: number }>({
    color: INK[0],
    width: PEN_WIDTHS[1],
  });
  const [moving, setMoving] = useState(false);
  const [named, setNamed] = useState<FilterKey | null>(null);
  const [busy, setBusy] = useState(false);
  const made = useRef(0);
  const live = useSharedValue(Skia.Path.Make());

  const image = useMemo(
    () => Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(photo.jpeg)),
    [photo.jpeg],
  );
  const shown = box === null ? null : fit(photo, box);
  const matrix = filterMatrix(edit.filter);
  const binY = window.height - insets.bottom - BIN_ZONE;

  // A filter's name shows for a moment after a swipe.
  useEffect(() => {
    if (named === null) return;
    const timer = setTimeout(() => {
      setNamed(null);
    }, editorFx.filterNameMs);
    return () => {
      clearTimeout(timer);
    };
  }, [named]);

  const newId = () => {
    made.current += 1;
    return `o${String(made.current)}`;
  };
  const changeFilter = (step: 1 | -1) => {
    setEdit((current) => {
      const filter = nextFilter(current.filter, step);
      setNamed(filter);
      return { ...current, filter };
    });
  };
  const addStroke = (path: string) => {
    if (path === '') return;
    setEdit((current) => withStroke(current, { path, color: pen.color, width: pen.width }));
  };

  // On the photo: a pen while drawing, else a swipe changes the filter.
  const drawing = Gesture.Pan()
    .enabled(mode === 'draw')
    .minDistance(0)
    .onStart((event) => {
      live.get().moveTo(event.x, event.y);
      notifyChange(live);
    })
    .onUpdate((event) => {
      live.get().lineTo(event.x, event.y);
      notifyChange(live);
    })
    .onEnd(() => {
      const path = live.get().toSVGString();
      live.get().reset();
      notifyChange(live);
      scheduleOnRN(addStroke, path);
    });
  const swipe = Gesture.Pan()
    .enabled(mode === 'idle')
    .activeOffsetX([-editorFx.swipeStart, editorFx.swipeStart])
    .failOffsetY([-editorFx.swipeStart, editorFx.swipeStart])
    .onEnd((event) => {
      if (Math.abs(event.translationX) < editorFx.swipeM) return;
      scheduleOnRN(changeFilter, event.translationX < 0 ? 1 : -1);
    });

  const openText = (overlay?: Overlay) => {
    setDraft(
      overlay === undefined
        ? NEW_DRAFT
        : { id: overlay.id, text: overlay.text, color: overlay.color, boxed: overlay.boxed },
    );
    setMode('text');
  };
  const closeText = () => {
    const words = draft.text.trim();
    setEdit((current) => {
      const before =
        draft.id === null ? undefined : current.overlays.find((each) => each.id === draft.id);
      if (words === '') return draft.id === null ? current : withoutOverlay(current, draft.id);
      return withOverlay(current, {
        id: draft.id ?? newId(),
        kind: 'text',
        text: words,
        color: draft.color,
        boxed: draft.boxed,
        x: before?.x ?? (shown?.width ?? 0) / 2,
        y: before?.y ?? (shown?.height ?? 0) / 2,
        scale: before?.scale ?? 1,
        rotation: before?.rotation ?? 0,
      });
    });
    setMode('idle');
  };
  const addSticker = (emoji: string) => {
    setEdit((current) =>
      withOverlay(current, {
        id: newId(),
        kind: 'sticker',
        text: emoji,
        color: INK[0],
        boxed: false,
        x: (shown?.width ?? 0) / 2,
        y: (shown?.height ?? 0) / 2,
        scale: 1,
        rotation: 0,
      }),
    );
    setMode('idle');
  };
  const next = () => {
    if (!isEdited(edit) || shown === null) {
      onDone(photo);
      return;
    }
    setBusy(true);
    // A moment for the button to show it is working before the drawing takes the thread.
    setTimeout(() => {
      const edited = composeEdit(photo, edit, shown);
      setBusy(false);
      if (edited === null) {
        toast.error(t('storyEditor.failed'));
        return;
      }
      onDone(edited);
    }, 0);
  };

  return (
    <View style={styles.screen} testID="story-editor">
      <View
        style={[styles.stage, { marginTop: insets.top, marginBottom: insets.bottom }]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setBox((current) =>
            current?.width === width && current.height === height ? current : { width, height },
          );
        }}
      >
        {shown === null ? null : (
          <View
            style={[
              styles.photo,
              { left: shown.left, top: shown.top, width: shown.width, height: shown.height },
            ]}
          >
            <GestureDetector gesture={Gesture.Exclusive(drawing, swipe)}>
              <Canvas
                style={{ width: shown.width, height: shown.height }}
                accessibilityLabel={t(`storyEditor.filters.${edit.filter}`)}
              >
                {image === null ? null : (
                  <SkiaImage
                    image={image}
                    x={0}
                    y={0}
                    width={shown.width}
                    height={shown.height}
                    fit="fill"
                  >
                    {matrix === null ? null : <ColorMatrix matrix={[...matrix]} />}
                  </SkiaImage>
                )}
                {edit.strokes.map((stroke, index) => (
                  <Path
                    key={index}
                    path={stroke.path}
                    style="stroke"
                    strokeWidth={stroke.width}
                    strokeCap="round"
                    strokeJoin="round"
                    color={stroke.color}
                  />
                ))}
                <Path
                  path={live}
                  style="stroke"
                  strokeWidth={pen.width}
                  strokeCap="round"
                  strokeJoin="round"
                  color={pen.color}
                />
              </Canvas>
            </GestureDetector>
            {edit.overlays
              .filter((overlay) => mode !== 'text' || overlay.id !== draft.id)
              .map((overlay) => (
                <OverlayItem
                  key={overlay.id}
                  overlay={overlay}
                  maxWidth={shown.width * TEXT_WIDTH}
                  binY={binY}
                  onMoving={setMoving}
                  onPlaced={(id, place) => {
                    setEdit((current) => withPlaced(current, id, place));
                  }}
                  onDropped={(id) => {
                    setEdit((current) => withoutOverlay(current, id));
                  }}
                  onEdit={(id) => {
                    const found = edit.overlays.find((each) => each.id === id);
                    if (found !== undefined) openText(found);
                  }}
                />
              ))}
          </View>
        )}
      </View>

      {named === null ? null : (
        <Animated.View
          key={named}
          entering={motion.pop}
          exiting={motion.fadeOut}
          pointerEvents="none"
          style={styles.named}
        >
          <Text style={styles.namedText} testID="story-editor-filter">
            {t(`storyEditor.filters.${named}`)}
          </Text>
        </Animated.View>
      )}

      {mode === 'idle' ? (
        <>
          <View style={[styles.top, { top: insets.top + space.sm }]}>
            <Tool
              testID="story-editor-close"
              icon={X}
              label={t('storyEditor.close')}
              onPress={onCancel}
            />
            <View style={styles.tools}>
              <Tool
                testID="story-editor-text"
                icon={Type}
                label={t('storyEditor.text')}
                onPress={() => {
                  openText();
                }}
              />
              <Tool
                testID="story-editor-draw"
                icon={PenLine}
                label={t('storyEditor.draw')}
                onPress={() => {
                  setMode('draw');
                }}
              />
              <Tool
                testID="story-editor-sticker"
                icon={Smile}
                label={t('storyEditor.sticker')}
                onPress={() => {
                  setMode('sticker');
                }}
              />
            </View>
          </View>
          {moving ? (
            <View
              pointerEvents="none"
              style={[styles.bin, { bottom: insets.bottom + space.lg }]}
              accessibilityLabel={t('storyEditor.bin')}
            >
              <Trash2 color={mediaColors.onBackdrop} size={26} strokeWidth={2.25} />
            </View>
          ) : (
            <View style={[styles.bottom, { bottom: insets.bottom + space.md }]}>
              <Text style={styles.hint}>{t('storyEditor.swipe')}</Text>
              <Button
                testID="story-editor-next"
                label={t('storyEditor.next')}
                loading={busy}
                onPress={next}
              />
            </View>
          )}
        </>
      ) : null}

      {mode === 'draw' ? (
        <>
          <View style={[styles.top, { top: insets.top + space.sm }]}>
            <Tool
              testID="story-editor-undo"
              icon={Undo2}
              label={t('storyEditor.undo')}
              disabled={edit.strokes.length === 0}
              onPress={() => {
                setEdit(withoutLastStroke);
              }}
            />
            <Tool
              testID="story-editor-draw-done"
              icon={Check}
              label={t('storyEditor.done')}
              onPress={() => {
                setMode('idle');
              }}
            />
          </View>
          <View style={[styles.bottom, { bottom: insets.bottom + space.md }]}>
            <View style={styles.row}>
              {PEN_WIDTHS.map((width, index) => (
                <PressableScale
                  key={width}
                  testID={`story-editor-width-${String(index)}`}
                  haptic="select"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: pen.width === width }}
                  accessibilityLabel={t(
                    `storyEditor.widths.${(['thin', 'medium', 'thick'] as const)[index] ?? 'medium'}`,
                  )}
                  onPress={() => {
                    setPen((current) => ({ ...current, width }));
                  }}
                  style={[styles.swatch, pen.width === width ? styles.chosen : null]}
                >
                  <View
                    style={{
                      width: width + space.xs,
                      height: width + space.xs,
                      borderRadius: radius.pill,
                      backgroundColor: mediaColors.onBackdrop,
                    }}
                  />
                </PressableScale>
              ))}
            </View>
            <Swatches
              chosen={pen.color}
              onChoose={(color) => {
                setPen((current) => ({ ...current, color }));
              }}
            />
          </View>
        </>
      ) : null}

      {mode === 'text' ? (
        <KeyboardAvoidingView
          style={[styles.layer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.textTop}>
            <PressableScale
              testID="story-editor-boxed"
              haptic="select"
              accessibilityRole="switch"
              accessibilityState={{ checked: draft.boxed }}
              accessibilityLabel={t('storyEditor.boxed')}
              onPress={() => {
                setDraft((current) => ({ ...current, boxed: !current.boxed }));
              }}
              style={[
                styles.boxedToggle,
                draft.boxed
                  ? { backgroundColor: mediaColors.onBackdrop }
                  : { borderColor: mediaColors.onBackdrop },
              ]}
            >
              <Text
                style={[
                  styles.boxedA,
                  { color: draft.boxed ? mediaColors.backdrop : mediaColors.onBackdrop },
                ]}
              >
                A
              </Text>
            </PressableScale>
            <Tool
              testID="story-editor-text-done"
              icon={Check}
              label={t('storyEditor.done')}
              onPress={closeText}
            />
          </View>
          <View style={styles.writing}>
            <View
              style={draft.boxed ? [styles.draftBox, { backgroundColor: draft.color }] : undefined}
            >
              <TextInput
                testID="story-editor-input"
                value={draft.text}
                onChangeText={(text) => {
                  setDraft((current) => ({ ...current, text }));
                }}
                autoFocus
                multiline
                placeholder={t('storyEditor.placeholder')}
                placeholderTextColor={mediaColors.track}
                accessibilityLabel={t('storyEditor.text')}
                allowFontScaling={false}
                style={[styles.input, { color: draft.boxed ? inkOn(draft.color) : draft.color }]}
              />
            </View>
          </View>
          <Swatches
            chosen={draft.color}
            onChoose={(color) => {
              setDraft((current) => ({ ...current, color }));
            }}
          />
        </KeyboardAvoidingView>
      ) : null}

      {mode === 'sticker' ? (
        <View
          style={[styles.layer, { paddingTop: insets.top + space.sm }]}
          testID="story-editor-stickers"
        >
          <View style={styles.textTop}>
            <Tool
              testID="story-editor-stickers-close"
              icon={X}
              label={t('storyEditor.close')}
              onPress={() => {
                setMode('idle');
              }}
            />
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            {STICKERS.map((emoji) => (
              <PressableScale
                key={emoji}
                testID={`story-editor-sticker-${emoji}`}
                haptic="select"
                accessibilityRole="button"
                accessibilityLabel={emoji}
                onPress={() => {
                  addSticker(emoji);
                }}
                style={styles.stickerCell}
              >
                <Text style={styles.stickerText} allowFontScaling={false}>
                  {emoji}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** A round control over the photo: white on a shade, as on a camera. */
function Tool({
  testID,
  icon: Icon,
  label,
  onPress,
  disabled = false,
}: {
  testID: string;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      testID={testID}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.tool, disabled ? styles.faint : null]}
    >
      <Icon color={mediaColors.onBackdrop} size={22} strokeWidth={2.25} />
    </PressableScale>
  );
}

/** The ink colours, one tap each. */
function Swatches({ chosen, onChoose }: { chosen: string; onChoose: (color: string) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {INK.map((color, index) => (
        <PressableScale
          key={color}
          testID={`story-editor-color-${String(index)}`}
          haptic="select"
          accessibilityRole="radio"
          accessibilityState={{ selected: chosen === color }}
          accessibilityLabel={t('storyEditor.color', { number: index + 1 })}
          onPress={() => {
            onChoose(color);
          }}
          style={[styles.swatch, chosen === color ? styles.chosen : null]}
        >
          <View style={[styles.dot, { backgroundColor: color }]} />
        </PressableScale>
      ))}
    </View>
  );
}

const SWATCH = touchTarget * 0.75;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: mediaColors.backdrop },
  stage: { flex: 1 },
  photo: { position: 'absolute', overflow: 'hidden', borderRadius: radius.md },
  top: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tools: { gap: space.sm },
  tool: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mediaColors.shade,
  },
  faint: { opacity: 0.4 },
  bottom: { position: 'absolute', left: space.md, right: space.md, gap: space.sm },
  hint: { color: mediaColors.onBackdrop, textAlign: 'center', opacity: 0.8 },
  named: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  namedText: { color: mediaColors.onBackdrop, fontSize: TEXT_SIZE, fontWeight: '700' },
  bin: {
    position: 'absolute',
    alignSelf: 'center',
    width: touchTarget * 1.25,
    height: touchTarget * 1.25,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mediaColors.shade,
    borderWidth: space.xxs,
    borderColor: mediaColors.onBackdrop,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.xs },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chosen: { borderWidth: space.xxs, borderColor: mediaColors.onBackdrop },
  dot: {
    width: SWATCH - space.md,
    height: SWATCH - space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: mediaColors.onBackdrop,
  },
  layer: { ...StyleSheet.absoluteFill, backgroundColor: mediaColors.shade, gap: space.md },
  textTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  boxedToggle: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    borderWidth: space.xxs,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxedA: { fontSize: 20, fontWeight: '700' },
  writing: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  draftBox: { borderRadius: radius.md, paddingHorizontal: space.sm },
  input: { fontSize: TEXT_SIZE, fontWeight: '700', textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.md,
  },
  stickerCell: {
    width: touchTarget * 1.4,
    height: touchTarget * 1.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickerText: { fontSize: touchTarget * 0.9 },
});

import {
  FontWeight,
  ImageFormat,
  PaintStyle,
  Skia,
  type SkCanvas,
  StrokeCap,
  StrokeJoin,
  TextAlign,
} from '@shopify/react-native-skia';

import { PHOTO_JPEG_MAX_BYTES, PHOTO_QUALITIES, type TakenPhoto } from '../messages/photo';
import { type Edit, inkOn, type Overlay, STICKER_SIZE, TEXT_SIZE } from './edit-model';
import { filterMatrix } from './filters';

/** Words wrap at this share of the photo's width, on screen and here alike. */
export const TEXT_WIDTH = 0.85;
/** The box under boxed words: room around them, and its corners (display pixels). */
export const BOX_PAD = 8;
export const BOX_RADIUS = 10;

/** One overlay drawn at its place: `k` is photo pixels per display pixel. */
function drawOverlay(canvas: SkCanvas, overlay: Overlay, k: number, displayWidth: number): void {
  const sticker = overlay.kind === 'sticker';
  const size = (sticker ? STICKER_SIZE : TEXT_SIZE) * k;
  const width = displayWidth * TEXT_WIDTH * k;
  const words = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
    .pushStyle({
      color: Skia.Color(overlay.boxed ? inkOn(overlay.color) : overlay.color),
      fontSize: size,
      fontStyle: { weight: FontWeight.Bold },
    })
    .addText(overlay.text)
    .build();
  words.layout(width);
  const height = words.getHeight();
  canvas.save();
  canvas.translate(overlay.x * k, overlay.y * k);
  canvas.rotate((overlay.rotation * 180) / Math.PI, 0, 0);
  canvas.scale(overlay.scale, overlay.scale);
  if (overlay.boxed && !sticker) {
    const line = words.getLongestLine();
    const pad = BOX_PAD * k;
    const box = Skia.Paint();
    box.setAntiAlias(true);
    box.setColor(Skia.Color(overlay.color));
    canvas.drawRRect(
      Skia.RRectXY(
        Skia.XYWHRect(-line / 2 - pad, -height / 2 - pad, line + pad * 2, height + pad * 2),
        BOX_RADIUS * k,
        BOX_RADIUS * k,
      ),
      box,
    );
  }
  words.paint(canvas, -width / 2, -height / 2);
  canvas.restore();
}

/**
 * The photo with what was put on it, drawn at its own size on this phone (docs/ADR/0035 Ek 3): the
 * filter, then the lines, then the words and stickers (the last moved on top), then written again
 * as a plain JPEG within the photo's limit (no EXIF; nothing of it leaves before it is sealed).
 * `display` is the size the photo was shown at while it was edited. Null if it cannot be drawn.
 */
export function composeEdit(
  photo: TakenPhoto,
  edit: Edit,
  display: { width: number; height: number },
): TakenPhoto | null {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(photo.jpeg));
  const surface = Skia.Surface.Make(photo.w, photo.h);
  if (image === null || surface === null) return null;
  const canvas = surface.getCanvas();
  const k = photo.w / display.width;

  const look = Skia.Paint();
  const matrix = filterMatrix(edit.filter);
  if (matrix !== null) look.setColorFilter(Skia.ColorFilter.MakeMatrix([...matrix]));
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, photo.w, photo.h),
    look,
  );

  canvas.save();
  canvas.scale(k, k);
  for (const stroke of edit.strokes) {
    const path = Skia.Path.MakeFromSVGString(stroke.path);
    if (path === null) continue;
    const pen = Skia.Paint();
    pen.setAntiAlias(true);
    pen.setStyle(PaintStyle.Stroke);
    pen.setStrokeWidth(stroke.width);
    pen.setStrokeCap(StrokeCap.Round);
    pen.setStrokeJoin(StrokeJoin.Round);
    pen.setColor(Skia.Color(stroke.color));
    canvas.drawPath(path, pen);
  }
  canvas.restore();

  for (const overlay of edit.overlays) drawOverlay(canvas, overlay, k, display.width);

  surface.flush();
  const drawn = surface.makeImageSnapshot();
  for (const quality of PHOTO_QUALITIES) {
    const jpeg = drawn.encodeToBytes(ImageFormat.JPEG, Math.round(quality * 100));
    if (jpeg.length > 0 && jpeg.length <= PHOTO_JPEG_MAX_BYTES) {
      return { jpeg, w: photo.w, h: photo.h };
    }
  }
  return null;
}

// Renders the app icon, Android adaptive icon layers, splash mark and notification icon as PNG from
// the brand logo (no image tools needed):
//   node scripts/build-icons.mjs
// The logo is the owner's (2026-10-23): a "b" that is a map pin, navy and orange, mountains, a
// river, an eagle, a crescent and a star, on white (assets/brand/bargu-logo.png, an 8-bit RGB PNG).
// Change the logo file and re-run.
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** Brighter than this on every channel is the logo's white background. */
const PAPER = 235;
/** The colour difference from white over which a pixel is fully "ink" for the one-colour icons. */
const INK = { from: 20, to: 120 };

// eslint-disable-next-line security/detect-non-literal-fs-filename -- the fixed logo file inside this repo
const source = decode(readFileSync(new URL('../assets/brand/bargu-logo.png', import.meta.url)));
const box = contentBox(source);

/** An 8-bit, non-interlaced RGB or RGBA PNG as RGB rows (what the logo file is). */
function decode(file) {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const [depth, colour, , , interlace] = file.subarray(24, 29);
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
    throw new Error('the logo must be an 8-bit, non-interlaced RGB or RGBA PNG');
  }
  const channels = colour === 6 ? 4 : 3;
  const parts = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') parts.push(file.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 3);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const corner = i >= channels ? previous[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = line[x * channels + c];
    }
    previous = line;
  }
  return { width, height, pixels };
}

/** The part of the logo that is not white paper. */
function contentBox({ width, height, pixels }) {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (pixels[i] < PAPER || pixels[i + 1] < PAPER || pixels[i + 2] < PAPER) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  return { left, top, width: right - left, height: bottom - top };
}

/** The logo's colour at a point, white paper outside it (paper whitened). */
function at(x, y) {
  const { width, height, pixels } = source;
  const px = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const py = Math.min(height - 1, Math.max(0, Math.floor(y)));
  if (x < 0 || y < 0 || x >= width || y >= height) return [255, 255, 255];
  const i = (py * width + px) * 3;
  const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
  return rgb.every((value) => value >= PAPER) ? [255, 255, 255] : rgb;
}

/** How much a colour is ink (0 white paper, 1 a colour of the logo), for the one-colour icons. */
function inkOf([r, g, b]) {
  const difference = Math.max(255 - r, 255 - g, 255 - b);
  return Math.min(1, Math.max(0, (difference - INK.from) / (INK.to - INK.from)));
}

/**
 * A square of `size` px with the logo's content `fill` of its height, centred: in colour on white,
 * or (`mono`) as a white shape on transparent. Each pixel averages the logo pixels it covers.
 */
function render(size, { fill, mono = false }) {
  const scale = (fill * size) / box.height;
  const offsetX = (size - box.width * scale) / 2;
  const offsetY = (size - box.height * scale) / 2;
  const step = 1 / scale;
  const samples = Math.max(1, Math.ceil(step));
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let sum = [0, 0, 0];
      let ink = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = box.left + (px + (sx + 0.5) / samples - offsetX) / scale;
          const y = box.top + (py + (sy + 0.5) / samples - offsetY) / scale;
          const colour = at(x, y);
          sum = sum.map((value, c) => value + colour[c]);
          ink += inkOf(colour);
        }
      }
      const count = samples * samples;
      const pixel = mono
        ? [255, 255, 255, Math.round((ink / count) * 255)]
        : [...sum.map((value) => Math.round(value / count)), 255];
      row.set(pixel, 1 + px * 4);
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = {
  // iOS / store icon: the logo on white (the OS applies its own mask).
  'icon.png': render(1024, { fill: 0.8 }),
  // Android adaptive icon on a white background colour (app.config): the logo small enough that
  // a round launcher mask (72 of 108 dp) never cuts its corners.
  'android-icon-foreground.png': render(1024, { fill: 0.55 }),
  // Themed icons are tinted by the launcher: the logo's shape alone, at the same size.
  'android-icon-monochrome.png': render(1024, { fill: 0.55, mono: true }),
  // Android status-bar notification icon: white shape on transparent, filling the square.
  'notification-icon.png': render(96, { fill: 0.92, mono: true }),
  // Splash mark on the white splash background.
  'splash-icon.png': render(512, { fill: 0.96 }),
};
for (const [name, data] of Object.entries(outputs)) {
  const file = new URL(`../assets/images/${name}`, import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed output files inside this repo (assets/images)
  writeFileSync(file, data);
  process.stdout.write(`wrote ${name} (${data.length} bytes)\n`);
}

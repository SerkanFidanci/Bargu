// Renders the app icon, Android adaptive icon layers and splash mark as PNG (no image tools needed):
//   node scripts/build-icons.mjs
// A white location pin on the brand violet, a coral dot (a friend) in its hollow centre. A placeholder brand mark until the
// final logo exists (docs/ADR/0008); change the shape or colours here and re-run.
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { crc32, deflateSync } from 'node:zlib';

const VIOLET = [0x5b, 0x34, 0xf2];
const WHITE = [0xff, 0xff, 0xff];
const CORAL = [0xff, 0x6a, 0x3d];
const SAMPLES = 4; // supersampling per axis for smooth edges

/** Coral dot in the pin's hollow (same geometry as pinCoverage). */
function dotCoverage(x, y, scale) {
  const dx = x;
  const dy = y + 0.1 * scale;
  const r = 0.065 * scale;
  return dx * dx + dy * dy <= r * r;
}

/** Pin in unit coordinates (-0.5..0.5, y down): head circle, tip, hollow centre. */
function pinCoverage(x, y, scale) {
  const head = { x: 0, y: -0.1 * scale, r: 0.27 * scale };
  const tip = { x: 0, y: 0.36 * scale };
  const hole = 0.11 * scale;
  const dx = x - head.x;
  const dy = y - head.y;
  const inHead = dx * dx + dy * dy <= head.r * head.r;
  // Triangle from the tangent points of the head circle to the tip.
  const d = tip.y - head.y;
  const sin = head.r / d;
  const cos = Math.sqrt(1 - sin * sin);
  const tangentY = head.y + head.r * sin;
  const tangentX = head.r * cos;
  const inTip =
    y >= tangentY && y <= tip.y && Math.abs(x) <= tangentX * ((tip.y - y) / (tip.y - tangentY));
  const inHole = dx * dx + dy * dy <= hole * hole;
  return (inHead || inTip) && !inHole;
}

function render(size, { background, scale, roundedCorner, dot = true }) {
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let pin = 0;
      let accent = 0;
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size - 0.5;
          const y = (py + (sy + 0.5) / SAMPLES) / size - 0.5;
          if (pinCoverage(x, y, scale)) pin += 1;
          else if (dot && dotCoverage(x, y, scale)) accent += 1;
          if (roundedCorner === undefined) inside += 1;
          else {
            const r = roundedCorner;
            const cx = Math.max(Math.abs(x) - (0.5 - r), 0);
            const cy = Math.max(Math.abs(y) - (0.5 - r), 0);
            if (cx * cx + cy * cy <= r * r) inside += 1;
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const p = pin / total;
      const a = accent / total;
      const fg = p + a;
      const bgAlpha = background === null ? 0 : inside / total;
      const alpha = fg + bgAlpha * (1 - fg);
      const color = [0, 1, 2].map((c) => {
        if (alpha === 0) return 0;
        const bg = background === null ? 0 : background[c];
        return Math.round((WHITE[c] * p + CORAL[c] * a + bg * bgAlpha * (1 - fg)) / alpha);
      });
      row.set([...color, Math.round(alpha * 255)], 1 + px * 4);
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
  // iOS / store icon: full square (the OS applies its own mask).
  'icon.png': render(1024, { background: VIOLET, scale: 0.92 }),
  // Android adaptive icon: the pin inside the 66 % safe zone; background is a colour (app.config).
  'android-icon-foreground.png': render(1024, { background: null, scale: 0.62 }),
  // Themed icons are tinted by the launcher: one shape, no colour detail.
  'android-icon-monochrome.png': render(1024, { background: null, scale: 0.62, dot: false }),
  // Splash mark, shown small on the violet splash background.
  'splash-icon.png': render(512, { background: null, scale: 1 }),
};
for (const [name, data] of Object.entries(outputs)) {
  const file = new URL(`../assets/images/${name}`, import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed output files inside this repo (assets/images)
  writeFileSync(file, data);
  process.stdout.write(`wrote ${name} (${data.length} bytes)\n`);
}

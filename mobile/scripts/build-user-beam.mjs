// Draws the soft facing beam under the location dot in the campus accent, light and dark, at 1x, 2x, and 3x.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const campus = JSON.parse(readFileSync(join(here, "..", "..", "app", "campus", "campus.json"), "utf8"));
const out = join(here, "..", "assets", "images");

const ACCENTS = { light: campus.theme?.accent, dark: campus.theme?.dark?.accent ?? campus.theme?.accent };
if (!/^#[0-9a-f]{6}$/i.test(ACCENTS.light ?? "") || !/^#[0-9a-f]{6}$/i.test(ACCENTS.dark ?? "")) {
  throw new Error("campus.json theme.accent and theme.dark.accent must be colors like #1268D2");
}

// A soft beam like a flashlight, the same one the web map draws: a 104 point square with the dot at its center,
// fanning up about 76 degrees, fading out toward both sides and toward its end, with no hard edge anywhere.
const SIZE = 104;
const CENTER = SIZE / 2;
const REACH = 48;
// Degrees either side of straight ahead: full strength out to FULL, gone by EDGE.
const FULL = 24;
const EDGE = 38;
const STOPS = [
  [0, 0.55],
  [0.2, 0.45],
  [0.6, 0.16],
  [1, 0],
];
const SAMPLES = 4;

const smooth = (t) => t * t * (3 - 2 * t);

function beam(x, y) {
  const dx = x - CENTER;
  const dy = CENTER - y;
  if (dy <= 0) return 0;
  const angle = Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
  const t = Math.hypot(dx, dy) / REACH;
  if (angle >= EDGE || t >= 1) return 0;
  const side = angle <= FULL ? 1 : 1 - smooth((angle - FULL) / (EDGE - FULL));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, a1] = STOPS[i];
    const [t0, a0] = STOPS[i - 1];
    if (t <= t1) return side * (a0 + ((t - t0) / (t1 - t0)) * (a1 - a0));
  }
  return 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(hex, scale) {
  const px = SIZE * scale;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rows = Buffer.alloc(px * (px * 4 + 1));
  for (let y = 0; y < px; y++) {
    const row = y * (px * 4 + 1);
    for (let x = 0; x < px; x++) {
      let alpha = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const ux = (x + (sx + 0.5) / SAMPLES) / scale;
          const uy = (y + (sy + 0.5) / SAMPLES) / scale;
          alpha += beam(ux, uy);
        }
      }
      const at = row + 1 + x * 4;
      rows[at] = r;
      rows[at + 1] = g;
      rows[at + 2] = b;
      rows[at + 3] = Math.round((alpha / SAMPLES ** 2) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(px, 0);
  header.writeUInt32BE(px, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [scheme, hex] of Object.entries(ACCENTS)) {
  for (const scale of [1, 2, 3]) {
    const name = `user-beam-${scheme}${scale === 1 ? "" : `@${scale}x`}.png`;
    writeFileSync(join(out, name), png(hex, scale));
    console.log(`wrote assets/images/${name}`);
  }
}

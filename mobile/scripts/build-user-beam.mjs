// Draws the facing cone under the location dot in the campus accent, light and dark, at 1x, 2x, and 3x.
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

// The same shape the cone had as an SVG: a 140 point square, the dot at its center, the light reaching up.
const SIZE = 140;
const CENTER = 70;
const REACH = 66;
const STOPS = [
  [0, 0.7],
  [0.45, 0.28],
  [1, 0],
];
const SAMPLES = 4;

const capCenterY = 8 + Math.sqrt(64 ** 2 - 40 ** 2);

function inside(x, y) {
  if (y >= 8 && y <= CENTER) {
    const half = ((CENTER - y) / (CENTER - 8)) * 40;
    return Math.abs(x - CENTER) <= half;
  }
  return y < 8 && Math.abs(x - CENTER) <= 40 && (x - CENTER) ** 2 + (y - capCenterY) ** 2 <= 64 ** 2;
}

function glow(x, y) {
  const t = Math.min(1, Math.hypot(x - CENTER, y - CENTER) / REACH);
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, a1] = STOPS[i];
    const [t0, a0] = STOPS[i - 1];
    if (t <= t1) return a0 + ((t - t0) / (t1 - t0)) * (a1 - a0);
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
          if (inside(ux, uy)) alpha += glow(ux, uy);
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

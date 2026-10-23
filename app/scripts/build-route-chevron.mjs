// Draws the chevron that marks the way along a route as a signed distance field, so both maps can tint it with the
// theme and keep its edges crisp at any size: public/icons/route-chevron.png and the phone app's copy.
// Run it again only to change the shape, then commit both files.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { APP_DIR } from "./lib/campus.mjs";

const SIZE = 64;
// The arrow points right; MapLibre turns it along the line, toward the destination.
const POINTS = [
  [0.34, 0.22],
  [0.66, 0.5],
  [0.34, 0.78],
];
const HALF_WIDTH = 0.1;
// How far, in pixels, the field reaches past the edge, and where the edge sits (the same cutoff MapLibre uses).
const RADIUS = 6;
const CUTOFF = 0.25;

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const point = [(x + 0.5) / SIZE, (y + 0.5) / SIZE];
    const nearest = Math.min(distanceToSegment(point, POINTS[0], POINTS[1]), distanceToSegment(point, POINTS[1], POINTS[2]));
    const signed = (nearest - HALF_WIDTH) * SIZE;
    const alpha = Math.round(Math.max(0, Math.min(255, 255 - 255 * (signed / RADIUS + CUTOFF))));
    pixels.set([255, 255, 255, alpha], (y * SIZE + x) * 4);
  }
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8);
const rows = Buffer.concat(Array.from({ length: SIZE }, (_, y) => Buffer.concat([Buffer.from([0]), pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4)])));
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(rows)),
  chunk("IEND", Buffer.alloc(0)),
]);

for (const file of [join(APP_DIR, "public", "icons", "route-chevron.png"), join(APP_DIR, "..", "mobile", "assets", "images", "route-chevron.png")]) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}

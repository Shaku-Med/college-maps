// Draws the round map icons for SOS phones, benches, trash cans, picnic tables, and bike racks as signed distance fields,
// a disc with the glyph cut out of it, so both maps tint them with the theme: public/icons and the phone app's copies.
// Run it again only to change a shape, then commit the files.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { APP_DIR } from "./lib/campus.mjs";

const lucide = async (name) => (await import(`lucide-react/dist/esm/icons/${name}.mjs`)).__iconData.node;

// Glyphs on lucide's 24 unit grid; benches and picnic tables have no lucide icon, so they are drawn here the same way.
const GLYPHS = {
  sos: await lucide("phone"),
  bench: [["path", { d: "M3 14h13l3-9M5 14v5M14 14v5" }]],
  trash: await lucide("trash"),
  picnic: [["path", { d: "M4 8h16M2 13h20M8 8 5 19M16 8l3 11" }]],
  bikes: await lucide("bike"),
};

const SIZE = 96;
const DISC = 38;
// The glyph fills this share of the disc's width, drawn bolder than lucide's 2 units so it reads at map size.
const GLYPH_SHARE = 0.6;
const STROKE_HALF_UNITS = 1.55;
// How far, in pixels, the field reaches past the edge, and where the edge sits (the same cutoff MapLibre uses).
const RADIUS = 9;
const CUTOFF = 0.25;

// ---- SVG shapes to line segments ----------------------------------------------------------------------

function arcPoints([x1, y1], rx, ry, angle, largeArc, sweep, [x2, y2]) {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const grow = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const vector = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = vector(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vector((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
  return Array.from({ length: steps }, (_, i) => {
    const t = start + (delta * (i + 1)) / steps;
    return [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  });
}

function cubicPoints(p0, p1, p2, p3) {
  return Array.from({ length: 16 }, (_, i) => {
    const t = (i + 1) / 16;
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
}

function pathPolylines(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
  const lines = [];
  let line = [];
  let at = [0, 0];
  let start = [0, 0];
  let lastControl = null;
  let command = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const flag = () => {
    // Arc flags can be written run together, like "a1 1 0 0 1 2 2" or "a1 1 0 01 2 2".
    const token = tokens[i];
    if (token.length > 1 && /^[01]/.test(token)) {
      tokens[i] = token.slice(1);
      return Number(token[0]);
    }
    i++;
    return Number(token);
  };
  const lineTo = (point) => {
    line.push(point);
    at = point;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const rel = command === command.toLowerCase();
    const off = (x, y) => (rel ? [at[0] + x, at[1] + y] : [x, y]);
    switch (command.toLowerCase()) {
      case "m": {
        if (line.length > 1) lines.push(line);
        at = off(num(), num());
        start = at;
        line = [at];
        command = rel ? "l" : "L";
        lastControl = null;
        break;
      }
      case "l":
        lineTo(off(num(), num()));
        lastControl = null;
        break;
      case "h":
        lineTo([rel ? at[0] + num() : num(), at[1]]);
        lastControl = null;
        break;
      case "v":
        lineTo([at[0], rel ? at[1] + num() : num()]);
        lastControl = null;
        break;
      case "c": {
        const c1 = off(num(), num());
        const c2 = off(num(), num());
        const end = off(num(), num());
        for (const point of cubicPoints(at, c1, c2, end)) line.push(point);
        at = end;
        lastControl = c2;
        break;
      }
      case "s": {
        const c1 = lastControl ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]] : at;
        const c2 = off(num(), num());
        const end = off(num(), num());
        for (const point of cubicPoints(at, c1, c2, end)) line.push(point);
        at = end;
        lastControl = c2;
        break;
      }
      case "q": {
        const c = off(num(), num());
        const end = off(num(), num());
        const c1 = [at[0] + ((c[0] - at[0]) * 2) / 3, at[1] + ((c[1] - at[1]) * 2) / 3];
        const c2 = [end[0] + ((c[0] - end[0]) * 2) / 3, end[1] + ((c[1] - end[1]) * 2) / 3];
        for (const point of cubicPoints(at, c1, c2, end)) line.push(point);
        at = end;
        lastControl = null;
        break;
      }
      case "a": {
        const [rx, ry, angle] = [num(), num(), num()];
        const largeArc = flag();
        const sweep = flag();
        const end = off(num(), num());
        for (const point of arcPoints(at, rx, ry, angle, largeArc, sweep, end)) line.push(point);
        at = end;
        lastControl = null;
        break;
      }
      case "z":
        lineTo(start);
        lastControl = null;
        break;
      default:
        throw new Error(`Unsupported path command ${command} in ${d}`);
    }
  }
  if (line.length > 1) lines.push(line);
  return lines;
}

function shapeSegments(node) {
  const lines = [];
  for (const [tag, attrs] of node) {
    const n = (key) => Number(attrs[key] ?? 0);
    if (tag === "path") lines.push(...pathPolylines(attrs.d));
    else if (tag === "line") lines.push([[n("x1"), n("y1")], [n("x2"), n("y2")]]);
    else if (tag === "circle") {
      lines.push(Array.from({ length: 49 }, (_, k) => [n("cx") + n("r") * Math.cos((k * Math.PI) / 24), n("cy") + n("r") * Math.sin((k * Math.PI) / 24)]));
    } else if (tag === "rect") {
      const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
      lines.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
    } else if (tag === "polyline" || tag === "polygon") {
      const points = attrs.points.trim().split(/[\s,]+/).map(Number);
      const line = [];
      for (let k = 0; k < points.length; k += 2) line.push([points[k], points[k + 1]]);
      if (tag === "polygon") line.push(line[0]);
      lines.push(line);
    } else throw new Error(`Unsupported shape ${tag}`);
  }
  const segments = [];
  for (const line of lines) for (let k = 1; k < line.length; k++) segments.push([line[k - 1], line[k]]);
  return segments;
}

// ---- Drawing ------------------------------------------------------------------------------------------

function distanceToSegment([px, py], [[ax, ay], [bx, by]]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function icon(node) {
  const segments = shapeSegments(node);
  const unit = (2 * DISC * GLYPH_SHARE) / 24;
  const origin = SIZE / 2 - 12 * unit;
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const disc = Math.hypot(px - SIZE / 2, py - SIZE / 2) - DISC;
      const grid = [(px - origin) / unit, (py - origin) / unit];
      const stroke = (Math.min(...segments.map((s) => distanceToSegment(grid, s))) - STROKE_HALF_UNITS) * unit;
      // Inside the disc and outside the glyph's strokes: the glyph is cut out of the disc.
      const signed = Math.max(disc, -stroke);
      const alpha = Math.round(Math.max(0, Math.min(255, 255 - 255 * (signed / RADIUS + CUTOFF))));
      pixels.set([255, 255, 255, alpha], (y * SIZE + x) * 4);
    }
  }
  return png(pixels);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: SIZE }, (_, y) => Buffer.concat([Buffer.from([0]), pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [kind, node] of Object.entries(GLYPHS)) {
  const file = icon(node);
  for (const path of [join(APP_DIR, "public", "icons", `amenity-${kind}.png`), join(APP_DIR, "..", "mobile", "assets", "images", `amenity-${kind}.png`)]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file);
  }
  console.log(`amenity-${kind}.png (${file.length} bytes)`);
}

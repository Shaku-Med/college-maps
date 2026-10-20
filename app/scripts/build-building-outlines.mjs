// Fetches each campus building's footprint from OpenStreetMap and writes src/data/building-outlines.json,
// so the apps can tell when someone is already inside the building they are heading to.
// Run it again when buildings are added to campus.json, then commit the file.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, fetchOverpass, overpassBox, readCampus } from "./lib/campus.mjs";

const OUT = join(APP_DIR, "src", "data", "building-outlines.json");
const SCALE = 1_000_000;
// A place pin dropped just outside its own walls still finds its building.
const NEAREST_METERS = 25;
// Points closer than this to the line between their neighbours add nothing at walking scale.
const SIMPLIFY_METERS = 0.8;

const campus = readCampus();
const query = `[out:json][timeout:90];
(
  way["building"](${overpassBox(campus.map.walkingArea)});
  relation["building"](${overpassBox(campus.map.walkingArea)});
);
out geom;`;

const toXY = (lat0) => {
  const metersPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return ([lat, lng]) => [lng * metersPerLng, lat * 110_540];
};

function inside(point, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > point[0] !== yj > point[0] && point[1] < ((xj - xi) * (point[0] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function distanceToRing(point, ring, xy) {
  const [px, py] = xy(point);
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = xy(ring[j]);
    const [bx, by] = xy(ring[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

function simplify(ring, xy) {
  const keep = (points) => {
    if (points.length < 3) return points;
    const [ax, ay] = xy(points[0]);
    const [bx, by] = xy(points.at(-1));
    let worst = 0;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const [px, py] = xy(points[i]);
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst <= SIMPLIFY_METERS) return [points[0], points.at(-1)];
    return [...keep(points.slice(0, index + 1)).slice(0, -1), ...keep(points.slice(index))];
  };
  const open = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  if (open.length <= 4) return open;
  // A closed ring starts and ends on the same point, so it is split at its far side and each half simplified.
  const [sx, sy] = xy(open[0]);
  let far = 1;
  for (let i = 1; i < open.length; i++) {
    const [x, y] = xy(open[i]);
    const [fx, fy] = xy(open[far]);
    if (Math.hypot(x - sx, y - sy) > Math.hypot(fx - sx, fy - sy)) far = i;
  }
  const first = keep(open.slice(0, far + 1));
  const second = keep([...open.slice(far), open[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

const elements = await fetchOverpass(query);
const rings = [];
for (const element of elements) {
  if (element.type === "way" && element.geometry?.length >= 4) {
    rings.push(element.geometry.map(({ lat, lon }) => [lat, lon]));
  } else if (element.type === "relation") {
    for (const member of element.members ?? []) {
      if (member.role === "outer" && member.geometry?.length >= 4) rings.push(member.geometry.map(({ lat, lon }) => [lat, lon]));
    }
  }
}

const xy = toXY(campus.map.center.latitude);
const outlines = {};
const missing = [];
for (const place of campus.places.filter((p) => p.isBuilding)) {
  const at = [place.latitude, place.longitude];
  let ring = rings.find((candidate) => inside(at, candidate));
  if (!ring) {
    const nearest = rings
      .map((candidate) => ({ candidate, distance: distanceToRing(at, candidate, xy) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance <= NEAREST_METERS) ring = nearest.candidate;
  }
  if (!ring) {
    missing.push(place.id);
    continue;
  }
  outlines[place.id] = simplify(ring, xy).flatMap(([lat, lng]) => [Math.round(lat * SCALE), Math.round(lng * SCALE)]);
}

const previous = (() => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return "";
  }
})();
const next = `${JSON.stringify({ scale: SCALE, outlines })}\n`;
writeFileSync(OUT, next);
console.log(`building-outlines.json: ${Object.keys(outlines).length} buildings, ${Math.round(next.length / 1024)} KB${previous === next ? " (unchanged)" : ""}`);
if (missing.length > 0) console.log(`No footprint found for: ${missing.join(", ")}`);

// Builds src/data/walk-graph.json from OpenStreetMap paths inside campus.json map.walkingArea.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, fetchOverpass, overpassBox, readCampus } from "./lib/campus.mjs";

const AREA = readCampus().map.walkingArea;
const HIGHWAYS =
  "footway|path|pedestrian|steps|service|residential|unclassified|tertiary|secondary|living_street|track|corridor|cycleway";
const SCALE = 1e6;

const query = `[out:json][timeout:90];
way["highway"~"^(${HIGHWAYS})$"](${overpassBox(AREA)});
(._;>;);
out body qt;`;

const elements = await fetchOverpass(query);

const coords = new Map();
for (const el of elements) if (el.type === "node") coords.set(el.id, [el.lat, el.lon]);

const walkable = (tags) => {
  if (tags.foot === "no" || tags.foot === "private") return false;
  if (tags.access === "no" && !["yes", "designated", "permissive"].includes(tags.foot)) return false;
  return true;
};

// Saved with each edge so routing can favor real walkways over the roads kept for reach. Matches routing.ts.
const KIND = { walkway: 0, steps: 1, road: 2, parking: 3, link: 4 };
const MAJOR_ROAD = /^(trunk|primary|secondary|tertiary)(_link)?$/;
const WALKWAYS = new Set(["footway", "path", "pedestrian", "corridor", "cycleway", "track"]);

const kindOf = (tags) => {
  if (tags.highway === "steps") return KIND.steps;
  if (WALKWAYS.has(tags.highway)) return KIND.walkway;
  if (tags.highway === "service" && tags.service === "parking_aisle") return KIND.parking;
  return KIND.road;
};

// Two ways over the same stretch: stairs stay stairs, otherwise the more walkable kind wins.
const mergeKind = (a, b) => (a === KIND.steps || b === KIND.steps ? KIND.steps : Math.min(a, b));

// Nobody steps across onto stairs, a bridge, a tunnel, or a big road between crossings.
const fixedWay = (tags) =>
  tags.highway === "steps" ||
  MAJOR_ROAD.test(tags.highway) ||
  (tags.bridge && tags.bridge !== "no") ||
  (tags.tunnel && tags.tunnel !== "no") ||
  (tags.layer && tags.layer !== "0");

const edges = new Map();
const adjacency = new Map();
const link = (a, b) => {
  if (!adjacency.has(a)) adjacency.set(a, new Set());
  if (!adjacency.has(b)) adjacency.set(b, new Set());
  adjacency.get(a).add(b);
  adjacency.get(b).add(a);
};

for (const el of elements) {
  if (el.type !== "way" || !el.tags || !walkable(el.tags)) continue;
  const kind = kindOf(el.tags);
  const fixed = fixedWay(el.tags);
  for (let i = 1; i < el.nodes.length; i++) {
    const a = el.nodes[i - 1];
    const b = el.nodes[i];
    if (a === b || !coords.has(a) || !coords.has(b)) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = edges.get(key);
    edges.set(key, {
      a,
      b,
      kind: existing ? mergeKind(existing.kind, kind) : kind,
      fixed: Boolean(existing?.fixed) || fixed,
    });
    link(a, b);
  }
}

const linksAdded = stitchNearbyPaths();

// A sidewalk drawn beside its road, or a path ending just short of another, gets a short link so nobody goes round the block.
function stitchNearbyPaths() {
  const LINK_METERS = 10;
  const SNAP_TO_END_METERS = 1.5;
  const CELL = 20;
  const enough = (meters) => meters * 3 + 30;
  const lat0 = (AREA.south + AREA.north) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const xy = (id) => {
    const [lat, lon] = coords.get(id);
    return [(lon - AREA.west) * kx, (lat - AREA.south) * 110540];
  };
  const keyOf = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const cellOf = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
  const grid = new Map();
  const index = (key) => {
    const { a, b } = edges.get(key);
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++) {
      for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) {
        const cell = `${cx}:${cy}`;
        if (!grid.has(cell)) grid.set(cell, new Set());
        grid.get(cell).add(key);
      }
    }
  };
  for (const key of edges.keys()) index(key);
  const nearbyEdges = (x, y) => {
    const found = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const key of grid.get(cellOf(x + dx * CELL, y + dy * CELL)) ?? []) if (edges.has(key)) found.add(key);
      }
    }
    return found;
  };
  const project = ([px, py], [ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const x = ax + t * dx;
    const y = ay + t * dy;
    return { t, x, y, meters: Math.hypot(px - x, py - y) };
  };
  const crosses = ([ax, ay], [bx, by], [cx, cy], [dx, dy]) => {
    const side = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    return side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 && side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0;
  };
  // How far each node is by the paths, out to `limit` meters.
  const walkFrom = (start, limit) => {
    const dist = new Map([[start, 0]]);
    const queue = [[0, start]];
    while (queue.length) {
      queue.sort((p, q) => q[0] - p[0]);
      const [d, id] = queue.pop();
      if (d > (dist.get(id) ?? Infinity)) continue;
      const here = xy(id);
      for (const next of adjacency.get(id) ?? []) {
        const there = xy(next);
        const nd = d + Math.hypot(there[0] - here[0], there[1] - here[1]);
        if (nd <= limit && nd < (dist.get(next) ?? Infinity)) {
          dist.set(next, nd);
          queue.push([nd, next]);
        }
      }
    }
    return dist;
  };
  const addEdge = (a, b, kind, fixed) => {
    const key = keyOf(a, b);
    edges.set(key, { a, b, kind, fixed });
    link(a, b);
    index(key);
  };

  let nextId = -1;
  let added = 0;
  for (const u of [...adjacency.keys()].sort((p, q) => p - q)) {
    const own = [...adjacency.get(u)].map((v) => edges.get(keyOf(u, v)));
    if (own.length === 0 || own.every((e) => e?.fixed)) continue;
    const p = xy(u);
    const candidates = [];
    for (const key of nearbyEdges(p[0], p[1])) {
      const e = edges.get(key);
      if (e.fixed || e.a === u || e.b === u) continue;
      const hit = project(p, xy(e.a), xy(e.b));
      if (hit.meters <= LINK_METERS) candidates.push({ key, e, hit });
    }
    if (candidates.length === 0) continue;
    candidates.sort((x, y) => x.hit.meters - y.hit.meters);
    const reached = walkFrom(u, enough(LINK_METERS));
    for (const { key, e, hit } of candidates) {
      const [ax, ay] = xy(e.a);
      const [bx, by] = xy(e.b);
      const viaA = (reached.get(e.a) ?? Infinity) + Math.hypot(hit.x - ax, hit.y - ay);
      const viaB = (reached.get(e.b) ?? Infinity) + Math.hypot(hit.x - bx, hit.y - by);
      if (Math.min(viaA, viaB) <= enough(hit.meters)) continue;
      const blocked = [...nearbyEdges((p[0] + hit.x) / 2, (p[1] + hit.y) / 2)].some((k) => {
        const other = edges.get(k);
        if (!other.fixed || k === key) return false;
        return crosses(p, [hit.x, hit.y], xy(other.a), xy(other.b));
      });
      if (blocked) continue;

      let v;
      if (Math.hypot(hit.x - ax, hit.y - ay) <= SNAP_TO_END_METERS) v = e.a;
      else if (Math.hypot(hit.x - bx, hit.y - by) <= SNAP_TO_END_METERS) v = e.b;
      else {
        v = nextId--;
        coords.set(v, [AREA.south + hit.y / 110540, AREA.west + hit.x / kx]);
        edges.delete(key);
        adjacency.get(e.a).delete(e.b);
        adjacency.get(e.b).delete(e.a);
        addEdge(e.a, v, e.kind, e.fixed);
        addEdge(v, e.b, e.kind, e.fixed);
      }
      if (v === u || adjacency.get(u).has(v)) continue;
      addEdge(u, v, KIND.link, true);
      added++;
      break;
    }
  }
  return added;
}

// Keep only the largest connected piece so every place snaps to a reachable path.
const seen = new Set();
let largest = [];
for (const start of adjacency.keys()) {
  if (seen.has(start)) continue;
  const component = [];
  const stack = [start];
  seen.add(start);
  while (stack.length) {
    const id = stack.pop();
    component.push(id);
    for (const next of adjacency.get(id)) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  if (component.length > largest.length) largest = component;
}

if (largest.length === 0)
  throw new Error("No walkable paths found in map.walkingArea. Check the box covers your campus.");

const index = new Map(largest.map((id, i) => [id, i]));
const baseLat = Math.round(AREA.south * SCALE);
const baseLng = Math.round(AREA.west * SCALE);

const nodes = [];
for (const id of largest) {
  const [lat, lng] = coords.get(id);
  nodes.push(Math.round(lat * SCALE) - baseLat, Math.round(lng * SCALE) - baseLng);
}

const edgeList = [];
const counts = [0, 0, 0, 0, 0];
for (const { a, b, kind } of edges.values()) {
  if (!index.has(a) || !index.has(b)) continue;
  edgeList.push(index.get(a), index.get(b), kind);
  counts[kind]++;
}

const graph = { version: 2, scale: SCALE, baseLat, baseLng, nodes, edges: edgeList };
const out = join(APP_DIR, "src", "data", "walk-graph.json");
writeFileSync(out, JSON.stringify(graph));

console.log(
  `nodes ${largest.length}, edges ${edgeList.length / 3} (walkway ${counts[KIND.walkway]}, steps ${counts[KIND.steps]}, road ${counts[KIND.road]}, parking ${counts[KIND.parking]}, links ${counts[KIND.link]} of ${linksAdded} added), dropped nodes ${adjacency.size - largest.length}`,
);
